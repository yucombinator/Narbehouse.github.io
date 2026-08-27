import * as THREE from 'three';
import { mulberry32 } from './rand.js';

export function buildGrassClumpGeometry() {
  const positions = [];
  const uvs = [];
  const normals = [];
  const bladeAttrs = [];
  const indices = [];

  // 5-blade natural bouquet: each blade has distinct origin offset, fanning angle,
  // botanical resting lean, height, and width.
  const bladeConfigs = [
    { ox:  0.00, oz:  0.00, angle:  0.00, lean: 0.24, height: 1.00, width: 0.062 },
    { ox:  0.08, oz:  0.05, angle:  1.25, lean: 0.22, height: 0.92, width: 0.056 },
    { ox: -0.08, oz: -0.05, angle: -1.25, lean: 0.21, height: 0.90, width: 0.054 },
    { ox:  0.00, oz: -0.08, angle:  2.9,  lean: 0.20, height: 0.84, width: 0.050 },
  ];

  // 4 height levels along the blade spine (3 segments). One fewer segment
  // than before: at blade scale (a few px wide) the curvature reads the same,
  // but it cuts vertex count ~40% (11 -> 7 verts per blade) — a big win for
  // the 38.5k-clump instanced draw on weaker GPUs.
  const levels = [
    { t: 0.00, w: 1.00 },
    { t: 0.35, w: 0.80 },
    { t: 0.70, w: 0.45 },
    { t: 1.00, w: 0.00 },
  ];

  let vertOffset = 0;

  for (const b of bladeConfigs) {
    const halfW = b.width * 0.5;

    // 3 quad segments (6 vertices: 2 per level)
    for (let li = 0; li < 3; li++) {
      const lv = levels[li];
      const w = halfW * lv.w;

      // Left edge vertex (u = 0.0)
      positions.push(b.ox, lv.t, b.oz);
      uvs.push(0.0, lv.t);
      normals.push(-1.0, 0.0, 0.0);
      bladeAttrs.push(b.angle, b.lean, b.height, w);

      // Right edge vertex (u = 1.0)
      positions.push(b.ox, lv.t, b.oz);
      uvs.push(1.0, lv.t);
      normals.push(1.0, 0.0, 0.0);
      bladeAttrs.push(b.angle, b.lean, b.height, w);
    }

    // Tip vertex (u = 0.5, t = 1.0)
    const tip = levels[3];
    positions.push(b.ox, tip.t, b.oz);
    uvs.push(0.5, tip.t);
    normals.push(0.0, 1.0, 0.0);
    bladeAttrs.push(b.angle, b.lean, b.height, 0.0);

    // Indices for 3 segments (2 quad pairs = 4 tris + 1 tip tri = 5 tris)
    for (let li = 0; li < 2; li++) {
      const i0 = vertOffset + li * 2;
      const i1 = i0 + 1;
      const i2 = i0 + 2;
      const i3 = i0 + 3;
      indices.push(
        i0, i1, i2,
        i2, i1, i3
      );
    }
    // Tip triangle:
    indices.push(
      vertOffset + 4, vertOffset + 5, vertOffset + 6
    );

    vertOffset += 7;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(bladeAttrs, 4));
  geo.setIndex(indices);
  return geo;
}

export function createGrass({ scene, hillsParams, skyBottom = 0xc8e6ff, lush = false }) {
  const hp = hillsParams;
  // Two quality levels (menu toggle, petalBloom.quality):
  //   Lush  - full clump counts, higher internal resolution (render.js)
  //   Faster (default) - a uniform ~83% subsample of every tier
  // Buffers are always ALLOCATED at lush counts; fast mode simply draws a
  // prefix of each tier. To make those prefixes spatially even, each tier's
  // instances are stratified below: the first FAST_N slots of a tier are a
  // Bresenham-uniform subsample of the whole tier, extras trail after.
  const LUSH_TIER1_COUNT = 18000; // Near domain (120m x 120m) dense carpet
  const LUSH_TIER2_COUNT = 40000; // Mid domain (180m x 180m), near-tier density
  const LUSH_TIER3_COUNT = 60000; // Far ring (400m box, outer 70-200m) lush mode
  const FAST_TIER1_COUNT = 15000;
  const FAST_TIER2_COUNT = 14000;
  const FAST_TIER3_COUNT = 1200;
// Tier 4 (Sky Reach): a sparse outer band (200-400m) in a fixed 800m
// domain, drawn for Lush mode and added progressively for Fast mode only
// when the petal is high. Fixed domain => the wrap never re-tiles, so the
// field stays put while floating/jumping.
const TIER4_COUNT = 160000;
const GRASS_COUNT = LUSH_TIER1_COUNT + LUSH_TIER2_COUNT + LUSH_TIER3_COUNT; // 95,000 allocated
const FAST_GRASS_COUNT = FAST_TIER1_COUNT + FAST_TIER2_COUNT + FAST_TIER3_COUNT; // 30,200 drawn in fast mode
const GRASS_COUNT_ALL = GRASS_COUNT + TIER4_COUNT; // 255,000 with outer band
  let lushMode = !!lush;

  const bladeBaseGeo = buildGrassClumpGeometry();
  const grassGeo = new THREE.InstancedBufferGeometry();
  grassGeo.setAttribute('position', bladeBaseGeo.getAttribute('position'));
  grassGeo.setAttribute('uv', bladeBaseGeo.getAttribute('uv'));
  grassGeo.setAttribute('normal', bladeBaseGeo.getAttribute('normal'));
  grassGeo.setAttribute('aBlade', bladeBaseGeo.getAttribute('aBlade'));
  grassGeo.setIndex(bladeBaseGeo.getIndex());

  const grassOffsets = new Float32Array(GRASS_COUNT_ALL * 2);
  const grassScales = new Float32Array(GRASS_COUNT_ALL * 2);
  const grassRotations = new Float32Array(GRASS_COUNT_ALL);
  const grassVariations = new Float32Array(GRASS_COUNT_ALL * 3);
  const grassPhases = new Float32Array(GRASS_COUNT_ALL);
  const grassTypes = new Float32Array(GRASS_COUNT_ALL);
  const grassDomains = new Float32Array(GRASS_COUNT_ALL);

  const gRand = mulberry32(1337);
  let gIdx = 0;

  // Helper to generate botanical clump attributes
  function populateClump(idx, ox, oz, domainSize, scaleMult = 1.0) {
    grassOffsets[idx * 2] = ox;
    grassOffsets[idx * 2 + 1] = oz;
    grassDomains[idx] = domainSize;
    grassRotations[idx] = gRand() * Math.PI * 2;

    const typeChoice = gRand();
    let type = 0.0;
    let sw = 1.0;
    let sh = 2.8;

    if (typeChoice > 0.82) {
      type = 2.0; // Broad ground-cover clover carpet
      sw = (1.05 + gRand() * 0.20) * scaleMult;
      sh = (1.60 + gRand() * 0.35) * scaleMult;
    } else if (typeChoice > 0.60) {
      type = 1.0; // Tall wild rye / golden wheat
      sw = (0.88 + gRand() * 0.18) * scaleMult;
      sh = (3.30 + gRand() * 0.50) * scaleMult;
    } else {
      type = 0.0; // Classic prairie meadow
      sw = (0.92 + gRand() * 0.20) * scaleMult;
      sh = (2.80 + gRand() * 0.45) * scaleMult;
    }

    grassTypes[idx] = type;
    grassScales[idx * 2] = sw;
    grassScales[idx * 2 + 1] = sh;
    grassVariations[idx * 3] = (gRand() - 0.5) * 0.15;
    grassVariations[idx * 3 + 1] = (gRand() - 0.5) * 0.2;
    grassVariations[idx * 3 + 2] = gRand();
    grassPhases[idx] = gRand() * Math.PI * 2;
  }

  // 1. Tier 1 (Near Dense Field): lush=18k clumps across 120m x 120m box
  const t1Grid = Math.ceil(Math.sqrt(LUSH_TIER1_COUNT));
  const t1Cell = 120.0 / t1Grid;
  for (let gx = 0; gx < t1Grid && gIdx < LUSH_TIER1_COUNT; gx++) {
    for (let gz = 0; gz < t1Grid && gIdx < LUSH_TIER1_COUNT; gz++) {
      const ox = -60.0 + (gx + gRand()) * t1Cell;
      const oz = -60.0 + (gz + gRand()) * t1Cell;
      populateClump(gIdx, ox, oz, 120.0, 1.0);
      gIdx++;
    }
  }
  // 2. Tier 2 (Mid Rolling Field): lush=17k clumps across 180m x 180m box,
  // grown ~30% larger than the near turf so the mid-field reads lush, not
  // stubby at distance.
  const t2End = LUSH_TIER1_COUNT + LUSH_TIER2_COUNT;
  const t2Grid = Math.ceil(Math.sqrt(LUSH_TIER2_COUNT));
  const t2Cell = 180.0 / t2Grid;
  for (let gx = 0; gx < t2Grid && gIdx < t2End; gx++) {
    for (let gz = 0; gz < t2Grid && gIdx < t2End; gz++) {
      const ox = -90.0 + (gx + gRand()) * t2Cell;
      const oz = -90.0 + (gz + gRand()) * t2Cell;
      populateClump(gIdx, ox, oz, 180.0, 1.3);
      gIdx++;
    }
  }

  // 3. Tier 3 (Far Ring): sparse grass filling the 70m..200m band (lush: 400m
  // domain, fast: same domain but fewer clumps via stratify) so the meadow
  // dissolves into the fog instead of clipping. Only the outer ring is
  // populated (Tier 2 already covers the inner disc), with a generous overlap
  // into Tier 2's fade so there is no density dip at the seam.
  const t3Domain = 400.0; // lush and fast share domain; fast draws sparser
  const t3Half = t3Domain * 0.5;
  const t3End = t2End + LUSH_TIER3_COUNT;
  // Keep the grid close to the requested population. Excessive oversampling
  // combined with row-major early termination left the far field populated
  // only on one side of the domain.
  const t3Grid = Math.ceil(Math.sqrt(LUSH_TIER3_COUNT / 0.85)); // reject the inner disc
  const t3Cell = t3Domain / t3Grid;
  for (let gx = 0; gx < t3Grid && gIdx < t3End; gx++) {
    for (let gz = 0; gz < t3Grid && gIdx < t3End; gz++) {
      const ox = -t3Half + (gx + gRand()) * t3Cell;
      const oz = -t3Half + (gz + gRand()) * t3Cell;
      if (Math.hypot(ox, oz) < 70.0) continue; // Tier 2 covers the inner disc
      populateClump(gIdx, ox, oz, t3Domain, 1.05);
      gIdx++;
    }
  }

  // 4. Tier 4 (Sky Reach): outer 140-400m band in a fixed 800m domain.
  // The overlap with Tier 3 hides the handoff where the nearer tier fades out.
  // Draws only at altitude in Fast mode (instanceCount), and on the ground in
  // Lush mode.
  const t4End = GRASS_COUNT_ALL;
  const t4Grid = Math.ceil(Math.sqrt(TIER4_COUNT / 0.80));
  const t4Cell = 800.0 / t4Grid;
  for (let gx = 0; gx < t4Grid && gIdx < t4End; gx++) {
    for (let gz = 0; gz < t4Grid && gIdx < t4End; gz++) {
      const ox = -400.0 + (gx + gRand()) * t4Cell;
      const oz = -400.0 + (gz + gRand()) * t4Cell;
      if (Math.hypot(ox, oz) < 140.0) continue; // overlap Tier 3 through its fade
      // Keep distant clumps legible at screen scale; their larger silhouette
      // fills the far field without adding another hard density boundary.
      populateClump(gIdx, ox, oz, 800.0, 1.8);
      gIdx++;
    }
  }

  // Stratify a tier slice [start, end) so its first `keep` slots are a
  // Bresenham-uniform subsample of the whole tier (every kept index spreads
  // evenly across the grid) and the remaining extras trail behind. Fast mode
  // draws prefixes, so this keeps the visible field spatially even while
  // cutting drawn clumps per tier. One-time cost at boot.
  function stratify(start, end, keep) {
    const total = end - start;
    const isKept = (i) =>
      Math.floor(((i + 1) * keep) / total) > Math.floor((i * keep) / total);
    const order = [];
    for (let i = 0; i < total; i++) if (isKept(i)) order.push(i);
    for (let i = 0; i < total; i++) if (!isKept(i)) order.push(i);
    const apply = (arr, stride) => {
      const tmp = arr.slice(start * stride, end * stride);
      for (let k = 0; k < total; k++) {
        const src = order[k] * stride;
        const dst = (start + k) * stride;
        for (let c = 0; c < stride; c++) arr[dst + c] = tmp[src + c];
      }
    };
    apply(grassOffsets, 2);
    apply(grassScales, 2);
    apply(grassRotations, 1);
    apply(grassVariations, 3);
    apply(grassPhases, 1);
    apply(grassTypes, 1);
    apply(grassDomains, 1);
  }
  stratify(0, LUSH_TIER1_COUNT, FAST_TIER1_COUNT);
  stratify(LUSH_TIER1_COUNT, LUSH_TIER1_COUNT + LUSH_TIER2_COUNT, FAST_TIER2_COUNT);
  stratify(LUSH_TIER1_COUNT + LUSH_TIER2_COUNT, GRASS_COUNT, FAST_TIER3_COUNT);

  grassGeo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(grassOffsets, 2));
  grassGeo.setAttribute('aScale', new THREE.InstancedBufferAttribute(grassScales, 2));
  grassGeo.setAttribute('aRotation', new THREE.InstancedBufferAttribute(grassRotations, 1));
  grassGeo.setAttribute('aVariation', new THREE.InstancedBufferAttribute(grassVariations, 3));
  grassGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(grassPhases, 1));
  grassGeo.setAttribute('aType', new THREE.InstancedBufferAttribute(grassTypes, 1));
  grassGeo.setAttribute('aDomain', new THREE.InstancedBufferAttribute(grassDomains, 1));
  // Terrain height per clump, recomputed on the CPU each frame. The vertex
  // shader used to recompute 4 trig ops per vertex (55 verts x 38.5k clumps
  // per frame); hoisting it to one CPU pass (38.5k clumps) moves the hill
  // sampling out of the per-vertex GPU path entirely.
  // JS port of GLSL mod (non-negative result for positive modulus).
function mod2(a, n) {
  return ((a % n) + n) % n;
}

// JS mirror of the shader's getHillHeight (same formula, same params).
function hillHeight(x, z) {
  return (
    hp.offset +
    hp.a1 * Math.sin(x * hp.f1x + hp.p1x) * Math.sin(z * hp.f1z + hp.p1z) +
    hp.b1 * Math.sin(x * hp.f2x + hp.p2x) * Math.sin(z * hp.f2z + hp.p2z)
  );
}

const grassHillY = new Float32Array(GRASS_COUNT_ALL);
  const hillAttr = new THREE.InstancedBufferAttribute(grassHillY, 1);
  hillAttr.setUsage(THREE.DynamicDrawUsage);
  grassGeo.setAttribute('aHillY', hillAttr);

  const TRAIL_MAX = 16;
  const trailArray = [];
  for (let i = 0; i < TRAIL_MAX; i++) {
    trailArray.push(new THREE.Vector4(0, -999, 0, -100));
  }
  let lastTrailTime = 0;
  const lastTrailPos = new THREE.Vector3();

  const grassMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() },
      uPetalPos: { value: new THREE.Vector3() },
      uPetalColor: { value: new THREE.Color(1, 0.6, 0.75) },
      uPetalBank: { value: 0 },
      uTrail: { value: trailArray },
      uTrailCount: { value: TRAIL_MAX },
      uWindDir: { value: new THREE.Vector2(0, -1) },
      uWindStrength: { value: 1.0 },

      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uHillsParams1: { value: new THREE.Vector4(hp.a1, hp.f1x, hp.p1x, hp.f1z) },
      uHillsParams2: { value: new THREE.Vector4(hp.p1z, hp.b1, hp.f2x, hp.p2x) },
      uHillsParams3: { value: new THREE.Vector4(hp.f2z, hp.p2z, hp.offset, 0) },
      fogColor: { value: new THREE.Color(skyBottom) },
      fogNear: { value: 90 },
      fogFar: { value: lushMode ? 650 : 320 },
    },
    vertexShader: `
      precision highp float;

      #define TRAIL_MAX 16

      uniform float uTime;
      uniform vec3 uCameraPos;
      uniform vec3 uPetalPos;
      uniform vec3 uPetalColor;
      uniform float uPetalBank;
      uniform vec4 uTrail[TRAIL_MAX];
      uniform int uTrailCount;
      uniform vec2 uWindDir;
      uniform float uWindStrength;
      uniform vec3 uSunDir;
      uniform vec4 uHillsParams1;
      uniform vec4 uHillsParams2;
      uniform vec4 uHillsParams3;

      attribute vec2 aOffset;
      attribute vec2 aScale;
      attribute float aRotation;
      attribute vec3 aVariation;
      attribute float aPhase;
      attribute float aType;
      attribute float aDomain;
      attribute float aHillY; // terrain height per clump (CPU-computed)
      attribute vec4 aBlade; // x = angle, y = lean, z = height, w = halfWidth

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vVariation;
      varying float vWindWave;
      varying float vWake;
      varying float vType;
      varying float vEdgeFade;
      varying float vHalo;

      void main() {
        vUv = uv;
        vVariation = aVariation;
        vType = aType;

        // The wrap domain is FIXED per tier (120/180/400/800 m) and never
        // scales with altitude: scaling L re-tiles every clump, which makes
        // the whole field visibly slide while floating. Tier classification
        // uses the base domain; altitude reach is added by Tier 4's extra
        // instances (drawn only when high), not by resizing existing tiers.
        float L = aDomain;
        float halfL = L * 0.5;
        float isTier2 = step(150.0, aDomain); // 0 for Tier 1, 1 for Tier 2+

        // 2-tier cascaded domain centers:
        // Tier 1: tight around player (-4m)
        // Tier 2: forward mid-field bias (-25m)
        float zBias = mix(4.0, 25.0, isTier2);
        vec2 center = vec2(uPetalPos.x, uPetalPos.z - zBias);

        float wx = center.x + mod(aOffset.x - center.x + halfL, L) - halfL;
        float wz = center.y + mod(aOffset.y - center.y + halfL, L) - halfL;
        float wy = aHillY; // terrain height precomputed per clump on the CPU

        // Far tiers behind the camera add cost and visual clutter, but the
        // camera trails the petal, so culling from the petal position would
        // also remove visible foreground grass between them. Use the actual
        // camera position to preserve that close strip.
        if (L > 150.0 && wz > uCameraPos.z + 5.0) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        // Smooth edge fade towards the domain boundary (domain-relative so
        // each tier dissolves at its own edge). Tier 1 also fades across its
        // last few metres so the dense near-field blends into Tier 2 instead
        // of stopping in a hard density ring at the sides.
        float distFromCenter = length(vec2(wx - center.x, wz - center.y));
        float edgeFade = 1.0;
        {
          float halfL = L * 0.5;
          float fadeW = mix(12.0, halfL * 0.18, isTier2);
          edgeFade = clamp((halfL - distFromCenter) / fadeW, 0.0, 1.0);
        }
        vEdgeFade = edgeFade;

        // Blade attributes and height parameter:
        float bAngle = aBlade.x;
        float bLean = aBlade.y;
        float bHeight = aBlade.z;
        float bHalfWidth = aBlade.w;

        float v = uv.y; // Height progress along blade (0 at root, 1 at tip)
        float u = uv.x < 0.25 ? -1.0 : (uv.x > 0.75 ? 1.0 : 0.0); // Lateral side parameter

        // Scale factors:
        float clumpScaleX = aScale.x * edgeFade;
        float clumpScaleY = aScale.y * (0.35 + 0.65 * edgeFade);
        // Distant hill crests can hide short blades behind the terrain's
        // silhouette. Give only far-tier grass a modest elevation lift so
        // those slopes still read as a continuous meadow.
        float hilltopLift = 1.0 + step(150.0, L) * smoothstep(-1.0, 3.5, wy) * 0.55;
        clumpScaleY *= hilltopLift;
        float H = bHeight * clumpScaleY;

        // Flexibility & motion multiplier per botanical type:
        float typeFlex = 1.0;
        if (aType > 1.5) {
          typeFlex = 0.70; // Broad ground-cover
        } else if (aType > 0.5) {
          typeFlex = 1.35; // Tall wild rye (most expressive wave motion)
        }

        // Blade root in world space (relative to clump origin on terrain):
        float cosR = cos(aRotation);
        float sinR = sin(aRotation);
        vec2 rootOffsetWorld = vec2(
          position.x * cosR - position.z * sinR,
          position.x * sinR + position.z * cosR
        ) * clumpScaleX;

        vec3 rootWorld = vec3(wx + rootOffsetWorld.x, wy, wz + rootOffsetWorld.y);

        // Blade facing & lateral side directions in world space:
        float worldAngle = aRotation + bAngle;
        float cosWA = cos(worldAngle);
        float sinWA = sin(worldAngle);
        vec2 worldBladeFace = vec2(-sinWA, cosWA);
        vec2 worldBladeSide = vec2(cosWA, sinWA);

        // Botanical resting lean displacement:
        vec2 restBend = worldBladeFace * (bLean * H);

        // 1. Global 2D Traveling Wind Wave across the entire terrain
        // Constant forward breeze direction along flight corridor (-z)
        vec2 windVec = vec2(0.0, -1.0);
        vec2 crossVec = vec2(1.0, 0.0);

        // Spatial coordinates along corridor and across corridor
        float distAlongWind = -wz;
        float distCrossWind = wx;

        // Multi-tier coordinated rolling gust waves:
        // - Broad macro swell (wavelength ~ 50m, period ~ 8.5s)
        float macroPhase = distAlongWind * 0.12 - uTime * 0.75 + sin(distCrossWind * 0.02) * 0.40;
        float macroSwell = sin(macroPhase) * 0.5 + 0.5;

        // - Primary rolling gust wavefront (wavelength ~ 26m, speed ~ 5.2m/s)
        float gustPhase = distAlongWind * 0.24 - uTime * 1.25 + sin(distCrossWind * 0.035) * 0.45;
        float gustWave = sin(gustPhase) * 0.5 + 0.5;
        float gustPower = gustWave * gustWave;

        // Combined gust envelope (gives rolling waves that surge and breathe naturally)
        float totalGust = macroSwell * 0.35 + gustPower * 0.65;

        // Harmonious lateral cross-sway (grass sways side-to-side as gusts roll through)
        float crossPhase = distAlongWind * 0.14 + distCrossWind * 0.08 - uTime * 1.6;
        float crossSway = sin(crossPhase);

        // Physical sway vectors:
        // - Forward bowing push (0.18..0.68 of blade height)
        // - Lateral dancing sway (-0.16..+0.16 of blade height)
        vec2 forwardSway = windVec * ((0.18 + totalGust * 0.50) * H * typeFlex);
        vec2 lateralSway = crossVec * (crossSway * (0.10 + totalGust * 0.08) * H * typeFlex);

        vec2 windDisplacement = forwardSway + lateralSway;

        // 2. Aerodynamic Grazing Wake & Trample (Distance-Gated)
        // High-performance optimization: Only evaluate trail loop for Tier 1 (L <= 80) near player (< 40m)
        float maxTrample = 0.0;
        vec2 trampleDisplacement = vec2(0.0);
        float wakeFactor = 0.0;
        vec2 instantWake = vec2(0.0);

        vec2 toPetal = vec2(wx - uPetalPos.x, wz - uPetalPos.z);
        float distToPetal = length(toPetal);

      // Soft petal-colour halo on the grass beneath. Kept subtle and tight —
      // a wide bright halo read as a "carpet" along the flight path.
      float hd = max(0.0, 1.0 - distToPetal * 0.22);
      // Wrapped tiers all contain a local copy near the petal. Restrict the
      // glow to the real near field so distant tiers cannot create a moving
      // duplicate light patch in front of the camera.
      vHalo = L <= 130.0 ? 0.16 * hd * hd : 0.0;

        if (L <= 130.0 && distToPetal < 30.0) {
          // Instant bow-wave parting as the petal glides over grass
          float grassTop = wy + H;
          float vertDist = max(0.0, uPetalPos.y - grassTop);
          float vertFactor = clamp(1.0 - vertDist / 3.2, 0.0, 1.0);
          
          float wakeRadius = 9.0;
          float wakeDistFactor = clamp(1.0 - distToPetal / wakeRadius, 0.0, 1.0);
          wakeFactor = wakeDistFactor * wakeDistFactor * vertFactor;

          vec2 wakeDir = distToPetal > 0.05 ? (toPetal / distToPetal) : vec2(0.0, -1.0);
          instantWake = (wakeDir * 1.05 + vec2(0.0, -0.55) + vec2(uPetalBank * 0.5, 0.0)) * (wakeFactor * typeFlex * H * 1.0);

          // Persistent trampled flight corridor
          for (int i = 0; i < TRAIL_MAX - 1; i++) {
            if (i >= uTrailCount - 1) break;
            vec4 pA = uTrail[i];
            vec4 pB = uTrail[i + 1];
            if (pA.w < 0.0 || pB.w < 0.0) continue;

            vec2 segA = vec2(pA.x, pA.z);
            vec2 segB = vec2(pB.x, pB.z);
            vec2 pos = vec2(wx, wz);
            vec2 segBA = segB - segA;
            float lenSq = dot(segBA, segBA);

            float segT = lenSq > 0.0001 ? clamp(dot(pos - segA, segBA) / lenSq, 0.0, 1.0) : 0.0;
            vec2 closest = segA + segBA * segT;
            float dist = length(pos - closest);
            float radius = 3.6; // Width of grazed wake corridor

            if (dist < radius) {
              float segTime = mix(pA.w, pB.w, segT);
              float age = uTime - segTime;

              if (age >= 0.0 && age <= 3.4) {
                float spatial = smoothstep(radius, 0.0, dist);
                float attack = smoothstep(0.0, 0.35, age);
                float decay = 1.0 - smoothstep(1.2, 3.4, age);
                float trample = spatial * attack * decay;

                if (trample > maxTrample) {
                  maxTrample = trample;
                  vec2 pushDir = dist > 0.05 ? normalize(pos - closest) : vec2(0.0, -1.0);
                  trampleDisplacement = (pushDir * 0.65 + vec2(0.0, -0.35)) * (trample * typeFlex * H * 0.55);
                }
              }
            }
          }
        }
        vWake = max(wakeFactor, maxTrample);

        // 3. Mathematical Euler Elastica Curve:
        // Combine natural botanical lean with wind, wake, and trample:
        vec2 totalBend = restBend + windDisplacement + instantWake + trampleDisplacement;
        float bendMag = length(totalBend);
        float maxBend = H * 0.88; // Physical maximum horizontal reach before flattening
        vec2 clampedBend = bendMag > maxBend ? (totalBend / bendMag) * maxBend : totalBend;

        float tipDelta = length(clampedBend);
        vec2 bendDir = tipDelta > 0.0001 ? (clampedBend / tipDelta) : vec2(0.0, 1.0);

        // Smooth parabolic spine curve: zero slope at base, increasing curvature towards tip
        float bendWeight = v * v * (1.5 - 0.5 * v);
        float horizDisp = tipDelta * bendWeight;
        vec2 spineXZ = bendDir * horizDisp;

        // Exact stalk length preservation along circular arc integral:
        float sagFactor = 0.667 * pow(tipDelta / max(0.001, H), 2.0);
        float spineY = H * (v - sagFactor * pow(v, 3.0));

        // Exact analytical tangent vector along the curve:
        float dHoriz = tipDelta * (3.0 * v - 1.5 * v * v);
        float dY = H * (1.0 - 2.0 * sagFactor * v * v);
        vec3 spineTangent = normalize(vec3(bendDir.x * dHoriz, max(0.04, dY), bendDir.y * dHoriz));

        // 4. Tangent-aligned cross section frame (side vector and face normal perpendicular to tangent):
        vec3 baseSide = vec3(worldBladeSide.x, 0.0, worldBladeSide.y);
        vec3 sideVec = normalize(baseSide - spineTangent * dot(baseSide, spineTangent));
        vec3 faceNorm = normalize(cross(sideVec, spineTangent));

        // Lateral width offset and subtle transverse arch across blade:
        float widthDisp = bHalfWidth * clumpScaleX * u;
        float arch = -0.15 * (1.0 - u * u) * bHalfWidth * clumpScaleX;

        vec3 worldPosition = rootWorld + 
          vec3(spineXZ.x, spineY, spineXZ.y) + 
          sideVec * widthDisp + 
          faceNorm * arch;

        vWorldPos = worldPosition;

        // Dynamic C-curve surface normal with transverse rounded profile:
        vec3 curvedNormal = normalize(faceNorm + sideVec * (u * 0.35));
        vNormal = curvedNormal;

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPosition, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform vec3 uSunDir;
      uniform vec3 uPetalColor;
      uniform vec3 uCameraPos;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying vec3 vVariation;
      varying float vWindWave;
      varying float vWake;
      varying float vType;
      varying float vEdgeFade;
      varying float vHalo;

      void main() {
        float h = vUv.y;

        vec3 terrainBase = mix(vec3(0.14, 0.28, 0.10), vec3(0.22, 0.38, 0.14), 0.5);

        vec3 colRoot;
        vec3 colMid;
        vec3 colTip;

        if (vType > 1.5) {
          // Type 2: Broad Ground-Cover Herbs (deep velvety warm olive)
          colRoot = vec3(0.10, 0.24, 0.08);
          colMid  = vec3(0.26, 0.46, 0.16);
          colTip  = vec3(0.44, 0.65, 0.20);
        } else if (vType > 0.5) {
          // Type 1: Tall Wild Rye / Golden Wheat (warm golden sunlit wheat tips)
          colRoot = vec3(0.14, 0.28, 0.08);
          colMid  = vec3(0.44, 0.56, 0.18);
          colTip  = vec3(0.92, 0.78, 0.36);
        } else {
          // Type 0: Classic Meadow Grass (warm sunlit sage-olive with golden tips)
          colRoot = vec3(0.12, 0.26, 0.08);
          colMid  = vec3(0.34, 0.54, 0.18);
          colTip  = vec3(0.68, 0.76, 0.28);
        }

        // Seamlessly dissolve blade roots into the terrain ground color
        colRoot = mix(terrainBase, colRoot, smoothstep(0.0, 0.20, h));

        vec3 baseColor;
        if (h < 0.40) {
          baseColor = mix(colRoot, colMid, h / 0.40);
        } else {
          baseColor = mix(colMid, colTip, (h - 0.40) / 0.60);
        }

        baseColor.r += vVariation.x * 0.05;
        baseColor.g += vVariation.y * 0.06;
        baseColor.b += (vVariation.x - vVariation.y) * 0.03;

        vec3 sunDir = normalize(uSunDir);
        float nDotL = max(0.0, dot(vNormal, sunDir));
        
        // Translucent Subsurface Scattering (warm golden back-light glow)
        float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * h * 0.52;
        
        vec3 skyLight = vec3(0.75, 0.88, 1.0) * (0.45 + 0.30 * vNormal.y);
        vec3 sunLight = vec3(1.0, 0.94, 0.76) * (nDotL * 0.75 + sss);

        // Grazed wake shimmer: subtle luminous reflection tracing the flight path
        float trampleShimmer = vWake * (0.25 + 0.75 * h);
        sunLight += vec3(1.0, 0.96, 0.75) * (trampleShimmer * 0.48);

        vec3 finalColor = baseColor * (skyLight + sunLight);

        // Soft glow from the player's petals onto the grass beneath (halo
        // computed per-vertex in the grass vertex shader).
        finalColor += uPetalColor * vHalo;

        // Blend into turf colour towards domain edges
        // Keep the far field green and sunlit while still hiding tier edges;
        // the old dark fallback made distant grass look like bare soil.
        vec3 groundColor = mix(vec3(0.14, 0.28, 0.08), vec3(0.22, 0.38, 0.13), 0.5);
        finalColor = mix(groundColor, finalColor, max(vEdgeFade, 0.55));

        // Medium-distance terrain blend: gently soften the clump pattern at
        // 100-200m before fog fully takes over — subtle enough to preserve
        // grass texture while hiding the worst of the grid artifacts.
        float camDist = length(vWorldPos - uCameraPos);
        float terpBlend = clamp((camDist - 100.0) / 100.0, 0.0, 1.0);
        finalColor = mix(finalColor, groundColor, terpBlend * 0.04);

        // Atmospheric distance fog
        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
        fogFactor = pow(fogFactor, 1.2);
        finalColor = mix(finalColor, fogColor, fogFactor);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(grassGeo, grassMat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  function update(timeSec, petalPos, bank, wind, cameraPos, petalColor) {
    // Update flight path history for persistent grass trample trail
    const distMoved = lastTrailPos.distanceTo(petalPos);
    if (timeSec - lastTrailTime > 0.08 || distMoved > 1.0) {
      for (let i = TRAIL_MAX - 1; i > 0; i--) {
        trailArray[i].copy(trailArray[i - 1]);
      }
      trailArray[0].set(petalPos.x, petalPos.y, petalPos.z, timeSec);
      lastTrailTime = timeSec;
      lastTrailPos.copy(petalPos);
    }

    grassMat.uniforms.uCameraPos.value.copy(cameraPos);
    grassMat.uniforms.uTime.value = timeSec;
    grassMat.uniforms.uPetalPos.value.set(petalPos.x, petalPos.y, petalPos.z);
    grassMat.uniforms.uPetalBank.value = bank;
    if (petalColor) grassMat.uniforms.uPetalColor.value.set(petalColor.r, petalColor.g, petalColor.b);
    grassMat.uniforms.uWindDir.value.set(0.0, -1.0);
    grassMat.uniforms.uWindStrength.value = 1.0;

    // Altitude-aware detail distance WITHOUT touching the wrap domains:
    // the extra Tier-4 clumps (fixed 800 m domain) are drawn for Lush mode
    // and added for Fast mode only when the petal is above cruise height.
    // Domains never scale,
    // so the existing field cannot slide or re-tile while floating/jumping.
    const alt = Math.max(0, petalPos.y - hillHeight(petalPos.x, petalPos.z));
    const altAboveCruise = Math.max(0, alt - 3.6);
    const skyReach = Math.min(1, altAboveCruise / 18); // full reach ~21.6m up
    const baseCount = lushMode ? GRASS_COUNT : FAST_GRASS_COUNT;
    // Lush mode uses the existing sparse outer band on the ground as well as
    // in the sky, extending the highest-quality meadow to the full 800m
    // domain. Fast mode keeps the extra band altitude-only.
    const lushOuterBand = lushMode ? TIER4_COUNT : 0;
    grassGeo.instanceCount = baseCount + Math.max(lushOuterBand, Math.round(TIER4_COUNT * skyReach));

    // Match the renderer's fog extension so grass haze tracks the terrain.
    if (grassMat.uniforms.fogFar) {
      const baseNear = 90, baseFar = lushMode ? 650 : 320;
      const fogScale = 1 + skyReach * 2.5; // 1x cruise .. 3.5x at full reach
      grassMat.uniforms.fogNear.value = Math.min(baseFar - 10, baseNear * (1 + (fogScale - 1) * 0.25));
      grassMat.uniforms.fogFar.value = baseFar * fogScale;
    }

    // Precompute the terrain height for every clump on the CPU (one pass)
    // instead of recomputing 4 trig ops per vertex on the GPU. The wrapped
    // world position mirrors the vertex shader's domain-wrap so the heights
    // stay in sync. Fixed domains => the wrap is stable at any altitude.
    {
      const px = petalPos.x, pz = petalPos.z;
      // Only the drawn prefix needs heights (fast mode skips its extras).
      for (let i = 0, n = grassGeo.instanceCount; i < n; i++) {
        const baseDomain = grassDomains[i];
        const L = baseDomain;
        const halfL = L * 0.5;
        const zBias = baseDomain > 150.0 ? 25.0 : 4.0; // tier by BASE domain
        const cx = px, cz = pz - zBias;
        const wx = cx + mod2(grassOffsets[i * 2] - cx + halfL, L) - halfL;
        const wz = cz + mod2(grassOffsets[i * 2 + 1] - cz + halfL, L) - halfL;
        grassHillY[i] = hillHeight(wx, wz);
      }
      hillAttr.needsUpdate = true;
    }
  }

  	function dispose() {
    scene.remove(mesh);
    bladeBaseGeo.dispose();
    grassGeo.dispose();
    grassMat.dispose();
  }

  return {
    mesh,
    material: grassMat,
    geometry: grassGeo,
    update,
    dispose,
    setDensity(v) { lushMode = !!v; },
  };
}
