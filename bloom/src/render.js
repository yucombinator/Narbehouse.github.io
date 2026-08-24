import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_VARIANTS } from './trail.js?v=8';
import { HILLS } from './hill.js';
import { windAt } from './wind.js';
import { createGrass } from './grass.js?v=16';

export const SKY_TOP = 0x529ef0;
export const SKY_BOTTOM = 0xc8e6ff;

// The day is a hike: each meadow has its own light. Sky gradient, fog depth,
// sun warmth, ambient fill and a subtle ground tint shift as Ben climbs —
// dawn garden, mid-morning valley, afternoon summit ridge.
export const MEADOW_THEMES = [
  {
    name: 'Ranger Station', line: 'Dawn. The ranger station wakes by the trailhead.',
    skyTop: 0x4f86d6, skyBottom: 0xffeadb, fogNear: 72, fogFar: 340,
    sunColor: 0xffe2ba, sunIntensity: 1.3,
    hemiSky: 0xf2e4d2, hemiGround: 0x7a9e5a, tint: [1.05, 1.0, 0.96],
    // Dawn: low, small, distant clouds hugging the horizon, warmed by the
    // sunrise — no tall cumulus overhead before the day has properly begun.
    cloud: { count: 5, yBand: [12, 30], zoBand: [-270, -150], scale: [1.2, 1.8], tint: 0xffe6cc, opacity: 0.9, flat: 0.8 },
    // At the trailhead you are at the BASE of the range: low distant foothills,
    // no snow, no lakes — the peaks are still a day's hike away.
    env: {
      mountains: { heightScale: 0.5, rangeScale: 1.12, snowLine: 999, tint: 1.0 },
      lakes: { count: 0 },
    },
  },
  {
    name: 'Valley Meadow', line: 'Mid-morning. The valley opens.',
    skyTop: 0x2f6fd8, skyBottom: SKY_BOTTOM, fogNear: 75, fogFar: 380,
    sunColor: 0xfff2d8, sunIntensity: 1.4,
    hemiSky: 0xcfe8ff, hemiGround: 0x7a9e4a, tint: [1, 1, 1],
    cloud: { count: 7, yBand: [28, 58], zoBand: [-240, -110], scale: [1.6, 2.4], tint: 0xffffff, opacity: 0.95, flat: 1.0 },
    // Mid-hike: the range looms closer, snow creeping down the peaks, and the
    // valley holds glacial moraine lakes — milky turquoise, carved by ice.
    env: {
      mountains: { heightScale: 1.0, rangeScale: 1.0, snowLine: 96, tint: 1.0 },
      lakes: { count: 2, color: 0x4a9d8a, rMin: 130, rMax: 205, sizeMin: 24, sizeMax: 58 },
    },
  },
  {
    name: 'Summit Ridge', line: 'Afternoon. The summit ridge.',
    skyTop: 0x1f5cc8, skyBottom: 0xdff0ff, fogNear: 95, fogFar: 430,
    sunColor: 0xfff7e0, sunIntensity: 1.5,
    hemiSky: 0xe4f2ff, hemiGround: 0x6a8e5e, tint: [0.93, 1.0, 1.03],
    // Summit: the day is mature — fuller, higher, closer clouds.
    cloud: { count: 9, yBand: [48, 90], zoBand: [-190, -80], scale: [2.0, 3.0], tint: 0xfff0e0, opacity: 0.97, flat: 1.0 },
    // At the summit you are IN the range: towering rocky peaks crowding the
    // horizon, snow low on the ridges, and a few high cold tarns.
    env: {
      mountains: { heightScale: 1.55, rangeScale: 0.9, snowLine: 82, tint: 1.02 },
      lakes: { count: 1, color: 0x5fa8c8, rMin: 120, rMax: 200, sizeMin: 14, sizeMax: 36 },
    },
  },
];

// --- Botanical Shading for Flowers, Stems, and Petals (Matching Grass SSS + Sun + Sky + Fog) ---
const FLOWER_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 color;
  attribute float aCenter;
  attribute float aThick;
  attribute float aAo;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;
  varying vec3 vInstanceColor;
  varying float vThick;
  varying float vAo;

  void main() {
    vColor = color;
    vCenter = aCenter;
    vThick = aThick;
    vAo = aAo;
    vInstanceColor = instanceColor;

    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    mat3 normalMat = mat3(modelMatrix * instanceMatrix);
    vNormal = normalize(normalMat * normal);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FLOWER_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;
  varying vec3 vInstanceColor;
  varying float vThick;
  varying float vAo;

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    // Warm golden-amber pollen stamen center; petals take vibrant instance
    // color with an organic per-petal gradient.
    vec3 pollenColor = vec3(1.15, 0.88, 0.28);
    vec3 baseColor = mix(vInstanceColor * vColor, pollenColor * vColor, vCenter);
    baseColor *= vAo; // ambient occlusion at the petal base / centre

    // Organic botanical lighting (harmonious with grass):
    // Wrapped diffuse keeps shaded sides airy so pastels never go muddy.
    float nDotL = max(0.0, dot(vNormal, sunDir) * 0.5 + 0.5);

    // Translucent Subsurface Scattering — strongest on thin petal tips/edges.
    float translucency = 0.45 + (1.0 - vThick) * 1.35;
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * (0.55 * (1.0 - vCenter * 0.45)) * translucency;

    // Hemispheric sky fill (bright floor = happy pastel read)
    vec3 skyLight = vec3(0.78, 0.90, 1.0) * (0.58 + 0.28 * max(0.0, vNormal.y));

    // Sun light with warm golden tone
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.48 + sss);

    // Soft specular sheen on the waxy petal surface
    vec3 halfV = normalize(sunDir + viewDir);
    float spec = pow(max(0.0, dot(vNormal, halfV)), 28.0) * (0.10 + (1.0 - vThick) * 0.12);
    vec3 specular = vec3(1.0, 0.97, 0.90) * spec;

    // Soft velvety rim sheen (Fresnel)
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.8) * 0.32;

    vec3 finalColor = baseColor * (skyLight + sunLight) + specular + vec3(1.0, 0.96, 0.88) * fresnel;

    // Atmospheric distance fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    fogFactor = pow(fogFactor, 1.2);
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const STEM_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 color;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vY;
  varying vec3 vTint;

  void main() {
    vColor = color;
    vY = position.y; // 0 at the root, 1 at the crown (geometry pre-translated)
    vTint = vec3(0.0);
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor; // the bud's own flower colour, set per instance
    #endif

    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    mat3 normalMat = mat3(modelMatrix * instanceMatrix);
    vNormal = normalize(normalMat * normal);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const STEM_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vY;
  varying vec3 vTint;

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    // Blend a whisper of the flower's own colour into the top third of the
    // stem — each stem quietly belongs to its bloom.
    float crownMix = smoothstep(0.55, 1.0, vY) * 0.35;
    vec3 baseColor = mix(vColor, vTint, crownMix);

    // Wrapped diffuse + bright sky floor: airy green, never black.
    float nDotL = max(0.0, dot(vNormal, sunDir) * 0.5 + 0.5);
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * 0.38;

    vec3 skyLight = vec3(0.78, 0.90, 1.0) * (0.58 + 0.28 * max(0.0, vNormal.y));
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.5 + sss);

    vec3 finalColor = baseColor * (skyLight + sunLight);

    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    fogFactor = pow(fogFactor, 1.2);
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

const MOTHER_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 color;
  attribute float aCenter;
  attribute float aThick;
  attribute float aAo;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;
  varying float vThick;
  varying float vAo;

  void main() {
    vColor = color;
    vCenter = aCenter;
    vThick = aThick;
    vAo = aAo;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    vNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const MOTHER_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec3 uColor;
  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;
  varying float vThick;
  varying float vAo;

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    vec3 pollenColor = vec3(1.18, 0.92, 0.32);
    vec3 baseColor = mix(uColor * vColor, pollenColor * vColor, vCenter);
    baseColor *= vAo;

    float nDotL = max(0.0, dot(vNormal, sunDir));
    float translucency = 0.45 + (1.0 - vThick) * 1.35;
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * (0.34 * (1.0 - vCenter * 0.45)) * translucency;

    vec3 skyLight = vec3(0.75, 0.88, 1.0) * (0.26 + 0.26 * max(0.0, vNormal.y));
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.55 + sss);

    vec3 halfV = normalize(sunDir + viewDir);
    float spec = pow(max(0.0, dot(vNormal, halfV)), 28.0) * (0.10 + (1.0 - vThick) * 0.12);
    vec3 specular = vec3(1.0, 0.97, 0.90) * spec;

    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.8) * 0.22;

    vec3 emissive = uColor * 0.14;
    vec3 finalColor = baseColor * (skyLight + sunLight) + specular + emissive + vec3(1.0, 0.96, 0.88) * fresnel;

    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    fogFactor = pow(fogFactor, 1.2);
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, 0.95);
  }
`;

const PETAL_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 color;
  attribute float aThick;
  attribute float aAo;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vThick;
  varying float vAo;

  void main() {
    vColor = color;
    vThick = aThick;
    vAo = aAo;

    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPos = worldPos.xyz;

    vNormal = normalize(mat3(modelMatrix) * normal);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const PETAL_FRAGMENT_SHADER = `
  precision highp float;

  uniform vec3 uColor;
  uniform float uGlow;
  uniform float uOpacity;
  uniform vec3 uSunDir;
  uniform vec3 uCameraPos;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vThick;
  varying float vAo;

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    vec3 baseColor = uColor * vColor;
    baseColor *= vAo;

    // Wrapped diffuse keeps shaded sides airy so pastels never go muddy.
    float nDotL = max(0.0, dot(vNormal, sunDir) * 0.5 + 0.5);

    // Translucent Subsurface Scattering (golden backlighting through petal),
    // strongest on the thin blade edges and tip.
    float translucency = 0.45 + (1.0 - vThick) * 1.35;
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * 0.65 * translucency;

    vec3 skyLight = vec3(0.78, 0.90, 1.0) * (0.58 + 0.28 * max(0.0, vNormal.y));
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.48 + sss);

    // Soft specular sheen on the waxy petal surface
    vec3 halfV = normalize(sunDir + viewDir);
    float spec = pow(max(0.0, dot(vNormal, halfV)), 28.0) * (0.10 + (1.0 - vThick) * 0.12);
    vec3 specular = vec3(1.0, 0.97, 0.90) * spec;

    // Velvet rim sheen (Fresnel)
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.6) * 0.45;

    // Constant pastel floor + emissive glow ramp on collection
    vec3 emissive = uColor * 0.16 + uColor * (0.10 + uGlow * 0.30);

    vec3 finalColor = baseColor * (skyLight + sunLight) + specular + emissive + vec3(1.0, 0.96, 0.90) * fresnel;

    // Atmospheric distance fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    fogFactor = pow(fogFactor, 1.2);
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

// Deterministic -1..1 pseudo-random from an integer seed (stable per petal).
function petalTint(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

// A petal as a curved, cupped surface: a rounded teardrop outline warped into
// a shallow spoon (tip and edges arch toward +z) so blooms read as organic
// petals. Attributes: color (brightness + per-petal tint), aCenter=0,
// aThick (thin translucent tip/edges, thick base), aAo (ambient occlusion at
// the base where the petal meets the centre).
function curvedPetal(len, wide, tint = 0) {
  // 3x4 segments keeps the curve readable at play distances with a quarter
  // of the triangles — flowers are the densest thing in the scene.
  const wSeg = 3;
  const lSeg = 4;
  const g = new THREE.PlaneGeometry(len, wide, wSeg, lSeg);
  // PlaneGeometry lies in XY: x = length (base -len/2 .. tip +len/2), y = width.
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const centers = new Float32Array(pos.count);
  const thick = new Float32Array(pos.count);
  const ao = new Float32Array(pos.count);
  const halfLen = len * 0.5;
  const halfWide = wide * 0.5;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = THREE.MathUtils.clamp((x + halfLen) / len, 0, 1); // 0 base .. 1 tip
    const u = THREE.MathUtils.clamp(y / halfWide, -1, 1);       // -1..1 across width

    // Rounded teardrop outline: narrow root, widest ~2/5 up, pinched tip.
    const raw = Math.sin(Math.PI * THREE.MathUtils.clamp(t * 1.2 - 0.02, 0, 1));
    const outline = Math.pow(raw, 0.75);
    const widthScale = 0.16 + 0.84 * outline;
    pos.setX(i, x);
    pos.setY(i, y * widthScale);

    // Shallow spoon curl: tip arches toward +z, edges lift a touch (concave).
    const cup = 0.12 * len;
    pos.setZ(i, cup * Math.pow(t, 1.4) + cup * 0.35 * u * u * t);

    // Brightness gradient (brighter toward the tip) plus a subtle warm/cool
    // per-petal tint so petals within one bloom differ like a real flower.
    const bright = 0.70 + t * 0.38;
    colors[i * 3] = bright * (1.0 + tint * 0.09);
    colors[i * 3 + 1] = bright * 0.98 * (1.0 - tint * 0.05);
    colors[i * 3 + 2] = bright * 0.94 * (1.0 - tint * 0.12);
    centers[i] = 0.0;
    // Thin translucent edges and tip, thicker base and centre vein.
    thick[i] = 0.18 + 0.82 * (1.0 - t) * (1.0 - u * u * 0.6);
    // Ambient occlusion: darker where the petal meets the centre.
    ao[i] = 0.55 + 0.45 * Math.min(1, t * 1.3);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 1));
  g.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
  g.setAttribute('aAo', new THREE.Float32BufferAttribute(ao, 1));
  g.computeVertexNormals(); // smooth normals across the shared grid vertices
  return g.toNonIndexed();  // non-indexed so mergeGeometries accepts it
}

// Fuzzy flower centre: a flattened pollen dome ringed by small floret buds.
function buildFlowerCenter(centerRadius) {
  const parts = [];
  const dome = new THREE.SphereGeometry(centerRadius, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55);
  dome.scale(1, 1, 0.72);
  parts.push(dome.toNonIndexed());
  const floretR = centerRadius * 0.5;
  const floretSize = centerRadius * 0.3;
  const florets = 8;
  for (let i = 0; i < florets; i++) {
    const a = (i / florets) * Math.PI * 2 + (i % 2) * 0.4;
    const fl = new THREE.SphereGeometry(floretSize, 8, 6);
    fl.translate(Math.cos(a) * floretR, Math.sin(a) * floretR, centerRadius * 0.42);
    parts.push(fl.toNonIndexed());
  }
  const merged = mergeGeometries(parts);
  const count = merged.attributes.position.count;
  const colors = new Float32Array(count * 3);
  const centers = new Float32Array(count);
  const thick = new Float32Array(count);
  const ao = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = 1.0;
    colors[i * 3 + 1] = 0.82;
    colors[i * 3 + 2] = 0.32;
    centers[i] = 1.0;
    thick[i] = 1.0; // centre is opaque, not translucent
    ao[i] = 1.0;
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  merged.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 1));
  merged.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
  merged.setAttribute('aAo', new THREE.Float32BufferAttribute(ao, 1));
  return merged;
}

// Layer recipes per shape. Each layer: tilt (radians lifting the petal tip),
// radius scale, optional half-step angular offset, and z push.
const SHAPE_LAYERS = {
  daisy: [ // flat ray fan — the original look
    { tilt: 0.35, r: 1.0 },
    { tilt: 0.7, r: 1.0, off: 0.5, z: -0.10 },
  ],
  cup: [ // tulip-style: petals gathered upright into a closed cup
    { tilt: 1.05, r: 1.0 },
    { tilt: 0.78, r: 0.74, off: 0.5, z: -0.06 },
  ],
  star: [ // open tulip: tips flare outward toward the sun
    { tilt: 0.3, r: 1.05 },
    { tilt: 0.5, r: 0.8, off: 0.5, z: -0.08 },
  ],
  rosette: [ // rose: three stepped layers spiral inward
    { tilt: 0.45, r: 1.0, off: 0 },
    { tilt: 0.8, r: 0.68, off: 0.33, z: -0.07 },
    { tilt: 1.15, r: 0.42, off: 0.66, z: -0.12 },
  ],
  wild: [ // wild rose: one open whorl of broad petals
    { tilt: 0.2, r: 1.08 },
  ],
  bell: [ // nodding bell: narrow petals held high
    { tilt: 1.25, r: 0.95, narrow: 0.74 },
    { tilt: 1.0, r: 0.7, off: 0.5, narrow: 0.74, z: -0.05 },
  ],
  spike: [ // lupine spire: tight upright tiers climbing a stem
    { tilt: 1.15, r: 0.6, narrow: 0.7 },
    { tilt: 1.35, r: 0.4, narrow: 0.64, off: 0.5, z: -0.05 },
  ],
  puff: [ // soft pompom: three short rounded tiers
    { tilt: 0.5, r: 0.95 },
    { tilt: 0.9, r: 0.68, off: 0.4, z: -0.05 },
    { tilt: 1.3, r: 0.44, off: 0.75, z: -0.09 },
  ],
};

function buildFlowerGeometry({ shape = 'daisy', petalRadius = 0.5, centerRadius = 0.26, petals = 5, spread = 1.0 } = {}) {
  const parts = [];
  const layers = SHAPE_LAYERS[shape] || SHAPE_LAYERS.daisy;
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const wideScale = L.narrow || 1;
    for (let i = 0; i < petals; i++) {
      const a = ((i + (L.off ?? 0)) / petals) * Math.PI * 2;
      const g = curvedPetal(petalRadius * 0.9 * L.r, petalRadius * 0.55 * L.r * wideScale * spread, petalTint(i * 2 + li));
      g.rotateY(-L.tilt); // lift the tip toward the viewer
      g.rotateZ(a);       // fan around the crown
      // Petals radiate FROM the pistil: the base tucks under the centre disc
      // (a larger offset left the petals floating detached from it).
      g.translate(
        Math.cos(a) * petalRadius * 0.62 * spread * Math.min(1, L.r),
        Math.sin(a) * petalRadius * 0.62 * spread * Math.min(1, L.r),
        L.z ?? 0 // deeper layers sit slightly behind
      );
      parts.push(g);
    }
  }
  parts.push(buildFlowerCenter(centerRadius));
  const merged = mergeGeometries(parts);
  // Flowers face the sky: the petal crown was built pointing +z (toward the
  // old viewer) — tilt the whole crown up so blooms stand upright in the
  // meadow and catch the sun, like real flowers.
  merged.rotateX(-Math.PI / 2);
  return merged;
}

const KIND_GEOMETRIES = FLOWER_VARIANTS.map((k) =>
  buildFlowerGeometry({ shape: k.shape, petalRadius: 0.68, centerRadius: k.bigCenter, petals: k.petals, spread: k.spread })
);
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.35, centerRadius: 0.5, petals: 8, spread: 1.25 });

// A small lanceolate leaf blade (pointed at both ends), drooping slightly.
function buildLeaf() {
  const g = new THREE.PlaneGeometry(0.16, 0.05, 1, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i); // -0.08 .. 0.08
    const t = THREE.MathUtils.clamp((x + 0.08) / 0.16, 0, 1);
    const w = Math.sin(Math.PI * t);
    pos.setY(i, pos.getY(i) * w);
    pos.setZ(i, -0.04 * t);   // gentle droop toward the ground
    pos.setX(i, x + 0.06);    // base tucks into the stem, tip points outward
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

// A slender stem for the collectible flowers: tapered green cylinder with
// three alternating leaves, rising from the ground (y=0..1, scaled to world
// length at placement).
function buildStemGeometry() {
  const cyl = new THREE.CylinderGeometry(0.03, 0.05, 1, 6);
  cyl.translate(0, 0.5, 0);
  const parts = [cyl.toNonIndexed()]; // CylinderGeometry is indexed; leaves aren't
  const leafHeights = [0.34, 0.58, 0.82];
  for (let i = 0; i < leafHeights.length; i++) {
    const leaf = buildLeaf();
    leaf.rotateY(i * 2.1 + 0.4);
    leaf.translate(0, leafHeights[i], 0);
    parts.push(leaf);
  }
  const merged = mergeGeometries(parts);
  const pos = merged.attributes.position;
  const col = new Float32Array(pos.count * 3);
  // Fresh yellow-green: darker at the grass shadow, brightening to the crown.
  const root = new THREE.Color(0x4a722f);
  const top = new THREE.Color(0xa9cf6d);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = root.clone().lerp(top, THREE.MathUtils.clamp(y, 0, 1));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return merged;
}
const STEM_GEO = buildStemGeometry();
const STEM_LEN = 3.2;
const CROWN_LIFT = STEM_LEN + 0.35; // crown height above the terrain (stands above grass)

// Player petal: a single curved blade along +z (flight direction) — wider
// rounded tip, narrower base, cupped gently along its length, like a real
// flower petal falling through the air rather than a scaled pill.
function buildPlayerPetal() {
  const g = new THREE.PlaneGeometry(0.18, 0.34, 7, 8); // x=width, y=length
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const thick = new Float32Array(pos.count);
  const ao = new Float32Array(pos.count);
  const halfLen = 0.17;
  const halfWide = 0.09;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const x = pos.getX(i);
    const t = THREE.MathUtils.clamp((y + halfLen) / 0.34, 0, 1); // 0 base .. 1 tip
    const u = THREE.MathUtils.clamp(x / halfWide, -1, 1);
    const outline = Math.pow(Math.sin(Math.PI * THREE.MathUtils.clamp(t * 1.1 - 0.03, 0, 1)), 0.7);
    const widthScale = 0.2 + 0.8 * outline;
    pos.setX(i, x * widthScale);
    pos.setZ(i, 0.05 * Math.pow(t, 1.4) + 0.02 * u * u * t); // gentle cup
    const bright = 0.68 + t * 0.36;
    colors[i * 3] = bright;
    colors[i * 3 + 1] = bright;
    colors[i * 3 + 2] = bright;
    thick[i] = 0.2 + 0.8 * (1.0 - t) * (1.0 - u * u * 0.5);
    ao[i] = 0.6 + 0.4 * Math.min(1, t * 1.2);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aThick', new THREE.Float32BufferAttribute(thick, 1));
  g.setAttribute('aAo', new THREE.Float32BufferAttribute(ao, 1));
  g.computeVertexNormals();
  g.rotateX(Math.PI / 2); // length axis -> +z (flight direction)
  return g.toNonIndexed();
}
const PETAL_GEO = buildPlayerPetal();
export const MAX_PETALS = 8;
const PETAL_RING_R = 0.3;

// Per-kind size tuning — MUST cover every FLOWER_VARIANTS entry (a missing
// entry yields undefined -> NaN scales -> invisible instances).
const KIND_SCALE = [1.0, 1.05, 0.95, 1.12, 0.95, 1.05, 1.02, 1.08, 0.9, 0.88, 0.95];

// Linear interpolation helper (the frame eases petals toward their slot).
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function buildMountainRange(cfg = {}) {
  // Per-theme shaping: how big, how close, how snowy the range reads. The
  // trailhead shows low distant foothills; the summit sits inside towering
  // peaks. Defaults match the original "mid-hike valley" look.
  const H = cfg.heightScale ?? 1;   // peak-height multiplier
  const RS = cfg.rangeScale ?? 1;   // distance multiplier (radius)
  const pos = [];
  const col = [];
  const meta = [];
  const index = [];
  const clamp = THREE.MathUtils.clamp;
  // Per-vertex: chain metadata packed for the shader as a vec4 —
  // (snowLine, green, tint, 0). Constant within a chain, so the fragment
  // shader can derive rock/snow/strata from continuous local-space fields
  // instead of per-quad vertex colours.
  const push = (x, y, z, r, g, b, m) => {
    pos.push(x, y, z);
    col.push(r, g, b);
    meta.push(m[0], m[1], m[2], 0);
  };

  // 1D value noise (hash lattice + smoothstep) — the base for ridged noise.
  function vnoise(x, seed) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * (3 - 2 * f);
    const a = hashOf(i, seed);
    const b = hashOf(i + 1, seed);
    return a + (b - a) * u; // 0..1
  }
  function hashOf(n, seed) {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  // Ridged multifractal (1D): folds noise into sharp V-shaped ridges and
  // weights each octave by how prominent the previous ridges were, so the
  // biggest massifs carry the most detail — the classic mountain-range
  // generator (Acerola / Josh's Channel / The Mountains of Madness). This
  // gives jagged skylines; plain additive noise only makes smooth bumps.
  function ridged(a, seed) {
    let amp = 0.5, freq = 1, sum = 0, norm = 0, prev = 1;
    for (let o = 0; o < 5; o++) {
      let n = 1 - Math.abs(vnoise(a * freq + seed * 13.7, seed + o * 101) * 2 - 1);
      n *= n;
      const w = Math.pow(Math.max(0, Math.min(1, prev * 1.5)), 0.8);
      sum += n * amp * w;
      norm += amp * w;
      prev = n;
      amp *= 0.5;
      freq *= 2.1;
    }
    return sum / norm; // 0..1
  }

  // Massif envelope (where big peaks cluster) modulated by ridged detail, so
  // crests are sharp and jagged while the valleys between massifs stay low.
  function profile(a, peaks, seed) {
    let env = 0;
    for (const p of peaks) env = Math.max(env, p.h * Math.exp(-((a - p.a) ** 2) / (2 * p.w * p.w)));
    const r = ridged(a * 1.8 + seed, seed);
    return Math.max(4, env * (0.60 + 1.05 * Math.pow(r, 1.15)));
  }

  // One ridgeline: front and back faces fan from the crest down to the plain.
  function ridgeChain(o) {
    const n = o.n;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      // Flat plateau across the chain; only the ends roll off to the plain.
      const taper = clamp(Math.min(t, 1 - t) / 0.16, 0, 1);
      const a = o.a0 + (o.a1 - o.a0) * t;
      const r = (o.r0 + (o.r1 - o.r0) * t + (Math.random() - 0.5) * 3) * RS;
      const h = profile(a, o.peaks, o.seed) * taper * H;
      pts.push({ a, r, h });
    }
    // Per-chain base colour (rock or pine). Every vertex of the chain shares
    // one colour — all texture variation is computed in the fragment shader
    // from continuous local-space fields, so there is nothing for adjacent
    // quads to step between. This kills the vertical banding the per-vertex
    // snow ramp produced.
    const snowLine = o.snowLine === 999 ? 999 : (cfg.snowLine ?? o.snowLine);
    const base = o.green ? [0.42, 0.49, 0.34] : [o.rock[0], o.rock[1], o.rock[2]];
    // Metadata for the shader: (snowLine, green, tint). snowLine 999 = no snow.
    const chainMeta = [snowLine, o.green ? 1 : 0, cfg.tint ?? o.tint];
    // Indexed emission: each control point contributes 3 shared vertices
    // (front base, crest, back base). Adjacent quads share vertices, so
    // computeVertexNormals yields SMOOTH normals along the ridge — the sun
    // shades continuously instead of stepping at every quad boundary
    // (which read as vertical bands on the non-indexed geometry).
    const v0 = pos.length / 3; // global vertex offset for this chain
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const sa = Math.sin(p.a), ca = Math.cos(p.a);
      // front base
      pos.push((p.r - o.front * RS) * sa, o.baseY, -(p.r - o.front * RS) * ca);
      col.push(base[0], base[1], base[2]);
      meta.push(chainMeta[0], chainMeta[1], chainMeta[2], 0);
      // crest
      pos.push(p.r * sa, p.h, -p.r * ca);
      col.push(base[0], base[1], base[2]);
      meta.push(chainMeta[0], chainMeta[1], chainMeta[2], 0);
      // back base
      pos.push((p.r + o.back * RS) * sa, o.baseY - 1, -(p.r + o.back * RS) * ca);
      col.push(base[0], base[1], base[2]);
      meta.push(chainMeta[0], chainMeta[1], chainMeta[2], 0);
    }
    for (let i = 0; i < n - 1; i++) {
      const F0 = v0 + i * 3, C0 = F0 + 1, B0 = F0 + 2;
      const F1 = v0 + (i + 1) * 3, C1 = F1 + 1, B1 = F1 + 2;
      // front face (camera side)
      index.push(F0, C0, F1, C0, C1, F1);
      // back face (shadow side)
      index.push(C0, B0, C1, B0, B1, C1);
    }
  }

  // --- Back range: three separated snowy massif groups. Gaps between the
  // groups are valleys that drop all the way to the plain, so the range
  // reads as massifs, not a continuous wall.
  ridgeChain({
    n: 30, a0: -1.2, a1: -0.55, r0: 330, r1: 352, front: 5, back: 12, baseY: -2,
    peaks: [{ a: -1.05, h: 86, w: 0.22 }, { a: -0.75, h: 68, w: 0.18 }],
    seed: 1.7, snowLine: 96, snowBand: 16,
    rock: [0.54, 0.58, 0.66], rockDark: [0.28, 0.31, 0.38], snow: [0.94, 0.97, 1.0],
    tint: 0.99, green: false,
  });
  ridgeChain({
    n: 34, a0: -0.3, a1: 0.3, r0: 318, r1: 344, front: 5, back: 12, baseY: -2,
    peaks: [{ a: -0.1, h: 92, w: 0.20 }, { a: 0.15, h: 78, w: 0.18 }],
    seed: 2.9, snowLine: 96, snowBand: 16,
    rock: [0.55, 0.59, 0.67], rockDark: [0.29, 0.32, 0.39], snow: [0.94, 0.97, 1.0],
    tint: 1.02, green: false,
  });
  ridgeChain({
    n: 30, a0: 0.55, a1: 1.2, r0: 332, r1: 356, front: 5, back: 12, baseY: -2,
    peaks: [{ a: 0.82, h: 88, w: 0.22 }, { a: 1.12, h: 64, w: 0.18 }],
    seed: 4.1, snowLine: 96, snowBand: 16,
    rock: [0.53, 0.57, 0.65], rockDark: [0.27, 0.30, 0.37], snow: [0.94, 0.97, 1.0],
    tint: 0.98, green: false,
  });

  // --- Distant continuations: the range recedes into the plain instead of
  // stopping. Low, hazy ridges fade out toward ±2.9 rad (≈166°) so the edge
  // is beyond any drag-look angle — no hard cliff from any view.
  ridgeChain({
    n: 26, a0: -2.9, a1: -1.22, r0: 350, r1: 372, front: 4, back: 10, baseY: -2,
    peaks: [{ a: -2.2, h: 30, w: 0.5 }, { a: -1.7, h: 26, w: 0.3 }],
    seed: 11.2, snowLine: 999, snowBand: 1,
    rock: [0.55, 0.59, 0.67], rockDark: [0.29, 0.32, 0.39], snow: [0.94, 0.97, 1.0],
    tint: 0.96, green: false,
  });
  ridgeChain({
    n: 26, a0: 1.22, a1: 2.9, r0: 354, r1: 374, front: 4, back: 10, baseY: -2,
    peaks: [{ a: 1.7, h: 26, w: 0.3 }, { a: 2.2, h: 30, w: 0.5 }],
    seed: 12.4, snowLine: 999, snowBand: 1,
    rock: [0.55, 0.59, 0.67], rockDark: [0.29, 0.32, 0.39], snow: [0.94, 0.97, 1.0],
    tint: 0.96, green: false,
  });

  // --- Mid ridges: sit in front of the valley mouths, lower than the back
  // massifs, so the valleys read as depth-layered passes onto the range.
  ridgeChain({
    n: 22, a0: -0.55, a1: -0.2, r0: 272, r1: 290, front: 4, back: 10, baseY: -2,
    peaks: [{ a: -0.4, h: 48, w: 0.20 }, { a: -0.28, h: 40, w: 0.16 }],
    seed: 5.3, snowLine: 999, snowBand: 1,
    rock: [0.52, 0.56, 0.63], rockDark: [0.27, 0.30, 0.36], snow: [0.94, 0.97, 1.0],
    tint: 1.03, green: false,
  });
  ridgeChain({
    n: 22, a0: 0.2, a1: 0.55, r0: 268, r1: 288, front: 4, back: 10, baseY: -2,
    peaks: [{ a: 0.35, h: 50, w: 0.20 }, { a: 0.48, h: 40, w: 0.16 }],
    seed: 6.6, snowLine: 999, snowBand: 1,
    rock: [0.52, 0.56, 0.63], rockDark: [0.27, 0.30, 0.36], snow: [0.94, 0.97, 1.0],
    tint: 0.97, green: false,
  });

  // --- Pine foothills: the nearest broken chain of forested ridges.
  const foot = (o) => ridgeChain({ front: 3, back: 8, baseY: -2, green: true, maxH: 30,
    snowLine: 999, snowBand: 1, tint: 1.0, ...o });
  foot({ n: 16, a0: -1.1, a1: -0.75, r0: 230, r1: 244,
    peaks: [{ a: -0.95, h: 24, w: 0.20 }], seed: 7.2 });
  foot({ n: 16, a0: -0.4, a1: -0.05, r0: 226, r1: 240,
    peaks: [{ a: -0.25, h: 20, w: 0.18 }], seed: 8.4 });
  foot({ n: 16, a0: 0.25, a1: 0.6, r0: 228, r1: 242,
    peaks: [{ a: 0.42, h: 22, w: 0.20 }], seed: 9.6 });
  foot({ n: 16, a0: 0.95, a1: 1.3, r0: 230, r1: 246,
    peaks: [{ a: 1.15, h: 26, w: 0.22 }], seed: 10.8 });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aMeta', new THREE.Float32BufferAttribute(meta, 4));
  geo.setIndex(index);
  // Shared ridge vertices + indexed emission => SMOOTH normals along the
  // ridge, so the sun shades continuously instead of stepping per quad.
  geo.computeVertexNormals();

  // Procedural rock texturing in the fragment shader. Flat vertex colors read
  // as plastic; real mountains have grain, scree on steep faces, strata, and
  // ragged snowlines. We replicate the scene lights (hemisphere + sun + rim)
  // in-shader and layer 3-octave value noise for detail, keyed to the baked
  // height/rock colour so snow and haze stay consistent with the geometry.
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: false,
    vertexColors: true,
    vertexShader: `
      // Local-space position and per-chain metadata. All texture variation
      // is computed from these continuous fields in the fragment shader, so
      // there is no per-vertex colour stepping between quads.
      attribute vec4 aMeta; // custom — three r160 does not inject it
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec4 vMeta;
      varying vec3 vColor;
      void main() {
        vLocal = position;
        vNormal = normalize(normalMatrix * normal);
        vMeta = aMeta;
        vColor = color;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying vec3 vLocal;
      varying vec3 vNormal;
      varying vec4 vMeta;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + 0.1);
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec3 x) {
        vec3 i = floor(x);
        vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash(i);
        float n100 = hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash(i + vec3(1.0, 1.0, 1.0));
        return mix(
          mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
          mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
          f.z);
      }
      float fbm(vec3 p) {
        return vnoise(p) * 0.55 + vnoise(p * 2.3) * 0.28 + vnoise(p * 5.1) * 0.17;
      }

      void main() {
        // Flat facet normal — the geometry is non-indexed with computed
        // normals, so every vertex already carries its face normal.
        vec3 N = normalize(vNormal);
        if (!gl_FrontFacing) N = -N;

        // Smooth normals (indexed geometry, shared ridge vertices) already
        // shade continuously along the ridge; no bump needed.
        float snowLine = vMeta.x;
        float green = vMeta.y;
        float tint = vMeta.z;

        // Rock/pine base — gray-blue rock or pine green, brightened with height.
        // (Constant per chain; all detail comes from the noise fields below.)
        vec3 rockBase = vec3(0.52, 0.56, 0.64);
        vec3 col = rockBase * (0.72 + 0.26 * clamp(vLocal.y / 70.0, 0.0, 1.0));
        if (green > 0.5) {
          col = mix(vec3(0.30, 0.36, 0.24), vec3(0.46, 0.52, 0.36), clamp(vLocal.y / 30.0, 0.0, 1.0));
        }
        col *= tint;

        // Continuous noise fields in LOCAL space — glued to the geometry,
        // so no world-position swimming as the walker moves. Only broad and
        // mid frequencies: fine grain at this distance aliases to static.
        float n1 = fbm(vLocal * 0.10);  // broad structure
        float n2 = fbm(vLocal * 0.38);  // mid detail

        // Snow from local height + noise-displaced snowline: ragged but
        // continuous along the ridge (no per-quad banding). Wide transition
        // so only the upper massifs carry a bright cap.
        float snow = 0.0;
        if (snowLine < 900.0) {
          float line = snowLine + (n1 - 0.5) * 12.0;
          snow = smoothstep(line, line + 22.0, vLocal.y);
        }
        snow *= 1.0 - green;

        // Rock grain — subtle, broad so it does not alias.
        col *= 0.96 + 0.08 * n2 * (1.0 - snow);

        // Scree: loose darker talus on steep faces, absent under snow.
        float slope = 1.0 - clamp(N.y, 0.0, 1.0);
        vec3 screeCol = mix(vec3(0.55, 0.53, 0.50), vec3(0.38, 0.36, 0.34), n2);
        col = mix(col, screeCol, smoothstep(0.30, 0.60, slope) * (1.0 - snow) * 0.45);

        // Strata banding along the height axis, gently broken by noise.
        float band = sin(vLocal.y * 0.6 + n1 * 5.0) * 0.5 + 0.5;
        col *= 0.94 + 0.10 * band * (1.0 - snow);

        // Snow brightening (only where the chain allows snow) — soft blue-
        // white, not pure white, so caps stay readable under full sun.
        col = mix(col, vec3(0.86, 0.90, 0.97) * tint, snow);

        // Atmospheric haze by distance — the mountains sit 200-370 units
        // out; far ridges melt toward the horizon instead of glowing white.
        float dist = length(vLocal.xz);
        float haze = clamp((dist - 160.0) / 240.0, 0.0, 1.0) * 0.4;
        col = mix(col, vec3(0.72, 0.84, 0.96), haze * (1.0 - snow * 0.4));

        // Lighting: hemisphere + sun + rim, matching the scene constants.
        vec3 skyC = vec3(0.81, 0.91, 1.00) * 0.75;
        vec3 gndC = vec3(0.48, 0.62, 0.29) * 0.6;
        vec3 hemi = mix(gndC, skyC, N.y * 0.5 + 0.5);
        vec3 sunDir = normalize(vec3(40.0, 70.0, 25.0));
        float sunD = max(dot(N, sunDir), 0.0);
        vec3 sunC = vec3(1.0, 0.95, 0.85) * 0.8 * sunD;
        vec3 rimDir = normalize(vec3(-45.0, 20.0, -30.0));
        float rimD = pow(max(dot(N, rimDir), 0.0), 1.6);
        vec3 rimC = vec3(0.75, 0.89, 1.0) * 0.35 * rimD;
        vec3 light = hemi + sunC + rimC;

        // Soft shoulder: 1 - exp(-x) keeps sunlit faces from clipping to
        // pure white while preserving the lit/dark contrast.
        vec3 linear = 1.0 - exp(-col * light * 1.35);

        // Output in sRGB like the renderer's built-in materials (the
        // renderer's output color space is sRGB; ShaderMaterial must encode
        // manually since three does not inject linearToOutputTexel here).
        vec3 encoded = mix(pow(linear, vec3(1.0 / 2.2)), linear * 12.92,
          vec3(lessThanEqual(linear, vec3(0.0031308))));
        gl_FragColor = vec4(encoded, 1.0);
      }
    `,
  }));
  mesh.frustumCulled = false;
  return mesh;
}

// Occasional distant lakes — flat blue water in the valleys ahead of the
// range, grounded on the terrain at their world position. Randomized in
// count (0-2), size, and position every session. Depth-tested like normal
// geometry (a hill in front correctly occludes them), and placed only where
// the camera-to-lake sight line clears the intervening terrain.
function buildLakes(cfg = {}) {
  const want = cfg.count ?? (Math.random() < 0.6 ? 1 + Math.floor(Math.random() * 2) : 0);
  if (!want) return null;
  const pos = [];
  const col = [];
  const index = [];
  const lakeMat = new THREE.MeshBasicMaterial({
    color: cfg.color ?? 0x3f7fb5, transparent: true, opacity: 0.85, fog: false, side: THREE.DoubleSide,
  });
  const rMin = cfg.rMin ?? 140;
  const rMax = cfg.rMax ?? 210;
  const sizeMin = cfg.sizeMin ?? 26;
  const sizeMax = cfg.sizeMax ?? 60;
  const camY = HILLS.height(0, 0) + 6; // camera rides ~6 above local terrain
  for (let l = 0; l < want; l++) {
    let cx = 0, cz = 0, ground = -10, lakeW = 30, lakeD = 30, ok = false;
    for (let attempt = 0; attempt < 14 && !ok; attempt++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const a = side * (0.3 + Math.random() * 0.6);        // 0.3-0.9 rad off center
      const r = rMin + Math.random() * (rMax - rMin);      // distance band
      cx = Math.sin(a) * r;
      cz = -Math.cos(a) * r;
      ground = HILLS.height(cx, cz);
      // Sight-line check: sample the ray from the camera to the lake centre;
      // reject if any intervening terrain pokes above it.
      const lakeY = ground + 0.6;
      const steps = 12;
      ok = true;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const px = cx * t, pz = cz * t;
        const rayY = camY + (lakeY - camY) * t;
        if (HILLS.height(px, pz) > rayY - 0.3) { ok = false; break; }
      }
      // Depression: the shoreline should read as a lake bed, not a hilltop.
      if (ok) {
        const n = 6;
        let sum = 0;
        for (let i = 0; i < n; i++) {
          const tt = (i / n) * Math.PI * 2;
          sum += HILLS.height(cx + Math.cos(tt) * 25, cz + Math.sin(tt) * 25);
        }
        ok = sum / n - ground > 0.25;
      }
    }
    if (!ok) continue;
    lakeW = sizeMin + Math.random() * (sizeMax - sizeMin);  // lake width
    lakeD = lakeW * (0.5 + Math.random() * 0.7);           // depth (ellipse)
    const seg = 14;
    const v0 = pos.length / 3;
    for (let i = 0; i < seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pos.push(cx + Math.cos(t) * lakeW * 0.5, ground + 0.6, cz + Math.sin(t) * lakeD * 0.5);
      col.push(1, 1, 1);
    }
    for (let i = 1; i < seg - 1; i++) {
      index.push(v0, v0 + i, v0 + i + 1);
    }
  }
  if (pos.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, lakeMat);
  mesh.frustumCulled = false;
  return mesh;
}

export function initRender(canvas) {
  // preserveDrawingBuffer stays off: keeping it forced a full framebuffer
  // copy-back every frame — one of the heaviest avoidable costs.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  // Shadows follow a smoothly-moving sun; refreshing the map at ~20Hz is
  // imperceptible and saves a full caster pass on the other frames.
  renderer.shadowMap.autoUpdate = false;
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 75, 380);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 520);
  camera.position.set(0, 10, 40);

  // Sky dome. Vertex colours are repainted per meadow theme (see paintSky).
  const skyGeo = new THREE.SphereGeometry(500, 24, 12);
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  scene.add(sky);
  function paintSky(theme) {
    const pos = skyGeo.attributes.position;
    const cols = skyGeo.attributes.color;
    const top = new THREE.Color(theme.skyTop);
    const bot = new THREE.Color(theme.skyBottom);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getY(i) / 500, 0, 1);
      cols.setXYZ(i, top.r * t + bot.r * (1 - t), top.g * t + bot.g * (1 - t), top.b * t + bot.b * (1 - t));
    }
    cols.needsUpdate = true;
  }

  // --- Infinite Dynamic GPU Terrain: A continuous rolling landscape generated
  // dynamically on the GPU. Centered on the camera and snapped to the grid so
  // it extends infinitely in all directions with zero seams or disappearing edges.
  const hp = HILLS.params;
  const terrainGeo = new THREE.PlaneGeometry(900, 900, 128, 128);
  terrainGeo.rotateX(-Math.PI / 2);

  const terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uHillsParams1: { value: new THREE.Vector4(hp.a1, hp.f1x, hp.p1x, hp.f1z) },
      uHillsParams2: { value: new THREE.Vector4(hp.p1z, hp.b1, hp.f2x, hp.p2x) },
      uHillsParams3: { value: new THREE.Vector4(hp.f2z, hp.p2z, hp.offset, 0) },
      uTint: { value: new THREE.Color(1, 1, 1) },
      fogColor: { value: new THREE.Color(SKY_BOTTOM) },
      fogNear: { value: 75 },
      fogFar: { value: 380 },
    },
    vertexShader: `
      precision highp float;

      uniform vec3 uCameraPos;
      uniform vec4 uHillsParams1;
      uniform vec4 uHillsParams2;
      uniform vec4 uHillsParams3;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vElevation;

      float getHillHeight(float x, float z) {
        float a1 = uHillsParams1.x;
        float f1x = uHillsParams1.y;
        float p1x = uHillsParams1.z;
        float f1z = uHillsParams1.w;
        
        float p1z = uHillsParams2.x;
        float b1 = uHillsParams2.y;
        float f2x = uHillsParams2.z;
        float p2x = uHillsParams2.w;
        
        float f2z = uHillsParams3.x;
        float p2z = uHillsParams3.y;
        float hillOffset = uHillsParams3.z;
        
        return hillOffset + 
          a1 * sin(x * f1x + p1x) * sin(z * f1z + p1z) + 
          b1 * sin(x * f2x + p2x) * sin(z * f2z + p2z);
      }

      void main() {
        // Snap to grid spacing so vertex coordinates don't swim during flight
        float snap = 5.0;
        float snapX = floor(uCameraPos.x / snap) * snap;
        float snapZ = floor(uCameraPos.z / snap) * snap;

        float wx = position.x + snapX;
        float wz = position.z + snapZ;
        float wy = getHillHeight(wx, wz);

        vWorldPos = vec3(wx, wy, wz);
        vElevation = wy;

        // Analytical normals for perfectly smooth hill shading
        float dhdx = 
          uHillsParams1.x * uHillsParams1.y * cos(wx * uHillsParams1.y + uHillsParams1.z) * sin(wz * uHillsParams1.w + uHillsParams2.x) +
          uHillsParams2.y * uHillsParams2.z * cos(wx * uHillsParams2.z + uHillsParams2.w) * sin(wz * uHillsParams3.x + uHillsParams3.y);
        
        float dhdz = 
          uHillsParams1.x * uHillsParams1.w * sin(wx * uHillsParams1.y + uHillsParams1.z) * cos(wz * uHillsParams1.w + uHillsParams2.x) +
          uHillsParams2.y * uHillsParams3.x * sin(wx * uHillsParams2.z + uHillsParams2.w) * cos(wz * uHillsParams3.x + uHillsParams3.y);

        vNormal = normalize(vec3(-dhdx, 1.0, -dhdz));

        gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPos, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;

      uniform float uTime;
      uniform vec3 uCameraPos;
      uniform vec3 uSunDir;
      uniform vec3 uTint;
      uniform vec3 fogColor;
      uniform float fogNear;
      uniform float fogFar;

      varying vec3 vWorldPos;
      varying vec3 vNormal;
      varying float vElevation;

      // Organic triangular-axis wave interference (zero checkerboard artifacts)
      float triWave(vec2 p, float freq) {
        vec2 q = p * freq;
        float w1 = sin(q.x);
        float w2 = sin(-0.5 * q.x + 0.866 * q.y);
        float w3 = sin(-0.5 * q.x - 0.866 * q.y);
        return (w1 + w2 + w3) * 0.3333;
      }

      void main() {
        vec2 pos = vWorldPos.xz;
        float distFromCam = length(pos - uCameraPos.xz);

        // Elevation & Slope parameters:
        float elevNorm = clamp((vElevation + 6.0) / 12.0, 0.0, 1.0);

        // Non-linear domain warping to create organic meadow contours
        vec2 warp = vec2(
          sin(pos.x * 0.032 + pos.y * 0.024),
          cos(pos.x * 0.024 - pos.y * 0.038)
        );
        vec2 warpedPos = pos + warp * 16.0;

        // --- Near Turf Shading (Base under 3D grass bouquet)
        vec3 cSoil = vec3(0.18, 0.30, 0.12);
        vec3 cLush = vec3(0.28, 0.46, 0.16);
        vec3 nearBase = mix(cSoil, cLush, elevNorm);

        // Smooth non-checkerboard near organic variations
        float nearVariation = (sin(pos.x * 0.3 + sin(pos.y * 0.4)) + cos(pos.y * 0.3 + sin(pos.x * 0.35))) * 0.025;
        nearBase += vec3(nearVariation, nearVariation * 1.3, nearVariation * 0.4);

        // --- Distant Procedural Meadow Landscape (blends in smoothly from 45m to 105m)
        float farBlend = smoothstep(45.0, 105.0, distFromCam);

        // 1. Organic botanical patches (large rolling meadow zones)
        float macroPattern = triWave(warpedPos, 0.045);
        float midPattern   = triWave(warpedPos + vec2(17.3, 41.8), 0.11);
        float meadowNoise  = macroPattern * 0.65 + midPattern * 0.35;

        // 2. Botanical color palette
        vec3 colMeadow = vec3(0.30, 0.52, 0.18); // Classic prairie sage-olive
        vec3 colWheat  = vec3(0.56, 0.64, 0.24); // Golden rye on sunlit hilltops
        vec3 colClover = vec3(0.16, 0.34, 0.10); // Deep velvety clover in valley hollows

        // Blend colors based on organic terrain topology (elevation + organic noise)
        float ridgeFactor = smoothstep(0.35, 0.85, elevNorm + meadowNoise * 0.35);
        float valleyFactor = smoothstep(0.45, 0.15, elevNorm - meadowNoise * 0.30);

        vec3 farMeadow = mix(colMeadow, colWheat, ridgeFactor);
        farMeadow = mix(farMeadow, colClover, valleyFactor);

        // 3. Fine grass tufts & stippling (rotated non-grid coordinates, distance-attenuated)
        mat2 rot45 = mat2(0.707, -0.707, 0.707, 0.707);
        vec2 rotPos = rot45 * pos;
        float tuftA = sin(rotPos.x * 1.8 + sin(rotPos.y * 1.5)) * 0.5 + 0.5;
        float tuftB = sin(pos.x * 3.4 - pos.y * 2.6) * 0.5 + 0.5;
        
        float microAtten = 1.0 - smoothstep(90.0, 240.0, distFromCam);
        float grassStipple = (tuftA * 0.6 + tuftB * 0.4 - 0.5) * microAtten * 0.14;
        farMeadow += vec3(grassStipple * 1.1, grassStipple * 1.4, grassStipple * 0.5);

        // 4. Harmonious rolling wind wave swells across distant hills
        float distAlongWind = -vWorldPos.z;
        float distCrossWind = vWorldPos.x;
        float wavePhase = distAlongWind * 0.24 - uTime * 1.25 + sin(distCrossWind * 0.035) * 0.45;
        float gustWave = sin(wavePhase) * 0.5 + 0.5;
        float gustSheen = gustWave * gustWave * (0.07 + 0.06 * elevNorm);
        farMeadow += vec3(0.10, 0.13, 0.03) * gustSheen;

        // Seamless transition from near turf to far meadow
        vec3 baseColor = mix(nearBase, farMeadow, farBlend);
        baseColor *= uTint; // meadow theme: dawn warms, summit cools

        vec3 sunDir = normalize(uSunDir);
        float nDotL = max(0.0, dot(vNormal, sunDir));
        vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.68 + 0.22);
        vec3 skyLight = vec3(0.75, 0.88, 1.0) * 0.48;

        vec3 finalColor = baseColor * (skyLight + sunLight);

        float depth = gl_FragCoord.z / gl_FragCoord.w;
        float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
        fogFactor = pow(fogFactor, 1.2);
        finalColor = mix(finalColor, fogColor, fogFactor);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `,
  });

  const ground = new THREE.Mesh(terrainGeo, terrainMat);
  ground.receiveShadow = true;
  ground.frustumCulled = false;
  scene.add(ground);

  // --- Grass: A lush, billowy meadow across 3 botanical varieties
  // (Prairie Meadow, Tall Golden Rye, and Broad Clover) with Euler Elastica curves.
  const grass = createGrass({
    scene,
    hillsParams: hp,
    skyBottom: SKY_BOTTOM,
  });  // --- Flower, Stem & Mother Materials (Unified with Grass SSS & Lighting) ---
  const flowerCrownMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uCameraPos: { value: new THREE.Vector3() },
      fogColor: { value: new THREE.Color(SKY_BOTTOM) },
      fogNear: { value: 75 },
      fogFar: { value: 380 },
    },
    vertexShader: FLOWER_VERTEX_SHADER,
    fragmentShader: FLOWER_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  const stemMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uCameraPos: { value: new THREE.Vector3() },
      fogColor: { value: new THREE.Color(SKY_BOTTOM) },
      fogNear: { value: 75 },
      fogFar: { value: 380 },
    },
    vertexShader: STEM_VERTEX_SHADER,
    fragmentShader: STEM_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
  });

  const motherMat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0xff8cb8) },
      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uCameraPos: { value: new THREE.Vector3() },
      fogColor: { value: new THREE.Color(SKY_BOTTOM) },
      fogNear: { value: 75 },
      fogFar: { value: 380 },
    },
    vertexShader: MOTHER_VERTEX_SHADER,
    fragmentShader: MOTHER_FRAGMENT_SHADER,
    side: THREE.DoubleSide,
    transparent: true,
  });

  let currentGlow = 0;
  function createPetalMaterial(colorHex) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colorHex) },
        uGlow: { value: currentGlow },
        uOpacity: { value: 1.0 },
        uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
        uCameraPos: { value: new THREE.Vector3() },
        fogColor: { value: new THREE.Color(SKY_BOTTOM) },
        fogNear: { value: 75 },
        fogFar: { value: 380 },
      },
      vertexShader: PETAL_VERTEX_SHADER,
      fragmentShader: PETAL_FRAGMENT_SHADER,
      side: THREE.DoubleSide,
      transparent: true,
    });
  }

  // --- Player: a swirling wreath of petals ("I am the wind, not the flower").
  // No center bloom, no heart — just loose petals circling a point.
  const petal = new THREE.Group();
  const petalRing = new THREE.Group();
  petal.add(petalRing);
  scene.add(petal);

  const petalMats = [];
  const petalMeshes = [];
  let petalColors = [0xff9ec0];
  let curPetalColor = 0xff9ec0; // most recently acquired petal colour -> grass glow
  const petalColorVec = new THREE.Color(); // reusable (avoids per-frame alloc)
  let nowSec = 0; // game clock, cached from frame() for eases
  let petalGeometry = PETAL_GEO; // upgraded to the CC-BY model when loaded
  let windIntensity = 0; // 0 = calm, 1 = full wind rush (ramps with steering)
  let boostLevel = 0;    // eased Space-burst level (0..1) — fov lift only
  let boostTarget = 0;
  let gustFx = 0;        // eased Enter-gust level (0..1) — breath surge + fov
  let gustFxTarget = 0;
  let frameNo = 0;
  const trailHistory = []; // {x,y,z} recent flight positions for the petal trail

  // Add ONE new petal (ease-in) without disturbing the existing swarm.
  // Existing petals keep their orbits/poses; only the next one appears small
  // at the centre and grows into place — no full-swarm reset on pickup.
  function spawnPetalMesh(from = null) {
    const color = petalColors[petalColors.length - 1] ?? 0xff9ec0;
    const mat = createPetalMaterial(color);
    const m = new THREE.Mesh(petalGeometry, mat);
    // Optional world-space origin (the flower just picked): convert to
    // wreath-local so the petal can fly in from its flower.
    let flyFrom = null;
    if (from && Number.isFinite(from.x)) {
      flyFrom = {
        x: from.x - petal.position.x,
        y: from.y - petal.position.y,
        z: from.z - petal.position.z,
      };
    }
    m.userData = {
      orbit: Math.random() * Math.PI * 2,
      dir: Math.random() < 0.5 ? -1 : 1,
      speed: 0.4 + Math.random() * 0.9,
      radius0: 0.28 + Math.random() * 0.85,
      flat: 0.45 + Math.random() * 0.85,
      z0: (Math.random() - 0.5) * 1.15,
      zdepth: 0.35 + Math.random() * 0.55,
      ph0: Math.random() * Math.PI * 2,
      breathe: 0.6 + Math.random() * 1.0,
      tumble: 1.1 + Math.random() * 1.6,
      born: nowSec, // eases in from the swarm centre
      baseYaw: (Math.random() - 0.5) * 2.6,
      basePitch: (Math.random() - 0.5) * 0.9,
      baseRoll: (Math.random() - 0.5) * 1.1,
      flyFrom, // {x,y,z} local — set while the join-flight is in progress
      flyT0: nowSec,
    };
    m.scale.setScalar(0.2); // start small at the centre
    m.position.set(flyFrom ? flyFrom.x : 0, flyFrom ? flyFrom.y : 0, flyFrom ? flyFrom.z : 0);
    petalRing.add(m);
    petalMeshes.push(m);
    petalMats.push(mat);
    return m;
  }

  function rebuildPetals() {
    for (const m of petalMeshes) {
      petalRing.remove(m);
      m.material.dispose();
    }
    petalMeshes.length = 0;
    petalMats.length = 0;
    const count = Math.max(1, Math.min(MAX_PETALS, petalColors.length));
    for (let i = 0; i < count; i++) {
      const color = petalColors[i] ?? petalColors[petalColors.length - 1];
      const mat = createPetalMaterial(color);
      const m = new THREE.Mesh(petalGeometry, mat);
      // Each petal tumbles on its own: distinct orbit radius, speed, phase,
      // breathing and tumble rates, so the swarm churns instead of rotating
      // as a rigid circle.
      // Petals are scattered through a loose 3D ball — distinct x/y/z origins
      // (z depth included) so they swirl as a swarm without stacking flat.
      const isNew = i === count - 1 && count > 1; // newest petal eases in
      m.userData = {
        orbit: Math.random() * Math.PI * 2,
        dir: Math.random() < 0.5 ? -1 : 1,
        speed: 0.4 + Math.random() * 0.9,
        radius0: 0.28 + Math.random() * 0.85,      // wider radial spread
        flat: 0.45 + Math.random() * 0.85,        // flatter/slanted orbit plane
        z0: (Math.random() - 0.5) * 1.15,          // distinct depth per petal
        zdepth: 0.35 + Math.random() * 0.55,
        ph0: Math.random() * Math.PI * 2,
        breathe: 0.6 + Math.random() * 1.0,
        tumble: 1.1 + Math.random() * 1.6,
        born: isNew ? nowSec : -10, // -10 = already fully grown in
        // A distinct "rest pose" per petal — yaw/pitch/roll offsets so the
        // swarm shows varied orientations (the model's front face differs
        // per petal), not every petal pointing the same way.
        baseYaw: (Math.random() - 0.5) * 2.6,
        basePitch: (Math.random() - 0.5) * 0.9,
        baseRoll: (Math.random() - 0.5) * 1.1,
      };
      m.scale.setScalar(isNew ? 0.2 : 1); // new petal starts small
      m.position.set(
        isNew ? 0 : Math.cos(m.userData.ph0) * m.userData.radius0,
        isNew ? 0 : Math.sin(m.userData.ph0) * m.userData.radius0 * m.userData.flat + (Math.random() - 0.5) * 0.4,
        isNew ? 0 : m.userData.z0
      );
      petalRing.add(m);
      petalMeshes.push(m);
      petalMats.push(mat);
    }
  }

  // Global shading: warm key sun from one side, cold sky fill above, and a
  // soft rim light from the opposite side so every surface — hills, flowers
  // and especially the tumbling petals — reads with form and a lit rim.
  const ambient = new THREE.HemisphereLight(0xcfe8ff, 0x7a9e4a, 0.95);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.4);
  sun.position.set(40, 70, 25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 220;
  sun.shadow.camera.left = -60;
  sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60;
  sun.shadow.camera.bottom = -60;
  const rim = new THREE.DirectionalLight(0xbfe4ff, 0.55);
  rim.position.set(-45, 20, -30);
  scene.add(ambient, sun, rim);
  ground.receiveShadow = true; // hills catch shade from flowers/petals
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  petal.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // --- Meadow theming: the hike's light --------------------------------
  let themeIndex = 0;
  let clouds = []; // built later; applyTheme re-skins them per stage
// Distant environment (backported from Frolic): a low-poly mountain range
// plus occasional lakes. Rebuilt per meadow from the theme's env profile —
// foothills at the trailhead, moraine lakes in the valley, soaring rocky
// peaks at the summit. Toggle: "Distant mountains & lakes" (petalBloom.env,
// default on). Skipped entirely when off — no scene cost.
let envMountains = null;
let envLakes = null;
let envThemeIndex = -1; // which meadow the current env was built for
let envOn = true;
try { envOn = localStorage.getItem('petalBloom.env') !== '0'; } catch { /* storage unavailable */ }
function rebuildEnv(theme) {
  if (!envOn) return;
  const ec = theme.env || {};
  if (envMountains) {
    scene.remove(envMountains);
    envMountains.geometry.dispose();
    envMountains.material.dispose();
  }
  envMountains = buildMountainRange(ec.mountains || {});
  scene.add(envMountains);
  if (envLakes) {
    scene.remove(envLakes);
    envLakes.geometry.dispose();
    envLakes.material.dispose();
  }
  envLakes = buildLakes(ec.lakes || {});
  if (envLakes) scene.add(envLakes);
}
let themeFogNear = 75, themeFogFar = 380; // baseline from the current theme
  function applyTheme(i) {
    const theme = MEADOW_THEMES[((i % MEADOW_THEMES.length) + MEADOW_THEMES.length) % MEADOW_THEMES.length];
    themeIndex = MEADOW_THEMES.indexOf(theme);
    paintSky(theme);
    scene.fog.color.set(theme.skyBottom);
    scene.fog.near = theme.fogNear;
    scene.fog.far = theme.fogFar;
    themeFogNear = theme.fogNear;
    themeFogFar = theme.fogFar;
    // Custom shaders carry their own fog uniforms — sweep the scene once per
    // theme change and sync every material that has them.
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) {
        if (m.uniforms && m.uniforms.fogColor) {
          m.uniforms.fogColor.value.set(theme.skyBottom);
          if (m.uniforms.fogNear) m.uniforms.fogNear.value = theme.fogNear;
          if (m.uniforms.fogFar) m.uniforms.fogFar.value = theme.fogFar;
        }
      }
    });
    if (terrainMat.uniforms.uTint) {
      terrainMat.uniforms.uTint.value.setRGB(theme.tint[0], theme.tint[1], theme.tint[2]);
    }
    sun.color.set(theme.sunColor);
    sun.intensity = theme.sunIntensity;
    ambient.color.set(theme.hemiSky);
    ambient.groundColor.set(theme.hemiGround);
    // Clouds grow through the day: at dawn a few low, warm, distant puffs
    // hug the horizon; by the summit they're fuller, higher and nearer.
    const cc = theme.cloud;
    if (cc && clouds.length) {
      puffMat.color.set(cc.tint);
      puffMat.opacity = cc.opacity;
      clouds.forEach((c, i) => {
        if (i >= cc.count) { c.visible = false; return; }
        c.visible = true;
        const s = cc.scale[0] + Math.random() * (cc.scale[1] - cc.scale[0]);
        c.scale.set(s, s * (cc.flat ?? 1), s);
        c.userData.zo = cc.zoBand[0] + Math.random() * (cc.zoBand[1] - cc.zoBand[0]);
        c.position.set(
          (Math.random() - 0.5) * 340,
          cc.yBand[0] + Math.random() * (cc.yBand[1] - cc.yBand[0]),
          camera.position.z + c.userData.zo
        );
      });
    }
    // The horizon grows with the hike: rebuild mountains + lakes only when
    // the meadow actually changes (not on every beginRun/restart of the same
    // meadow), so the backdrop is stable while you're in a stage.
    if (envOn && themeIndex !== envThemeIndex) {
      rebuildEnv(theme);
      envThemeIndex = themeIndex;
    }
  }
  applyTheme(0); // the day begins in the garden at dawn

  // --- Buds (one InstancedMesh per kind, child of world) ---
  let budMeshes = [];
  let stemMeshes = [];
  const budDummy = new THREE.Object3D();     // hoisted scratch objects —
  const stemDummy = new THREE.Object3D();    // never allocated per-frame
  let budData = [];
  let budTimes = [];
  // Bloom-on-pass: every bud starts closed and opens as the petal flies near
  // it, then stays open for the rest of the visit. Fresh meadow = fresh buds.
  let budOpen = []; // 0 = closed, 1 = fully bloomed (latched)
  const BLOOM_NEAR = 9;   // distance at which blooming starts
  const BLOOM_FAR = 46;   // fully open when closer than this
  let budLocal = [];
  const pops = [];
  const ringPool = [];
  for (let i = 0; i < 10; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.48, 28),
      new THREE.MeshBasicMaterial({ color: 0xfff4e0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.visible = false;
    scene.add(ring);
    ringPool.push(ring);
  }
  let ringCursor = 0;

  // Stop beacons: a faint vertical glow column marking each meadow stop so
  // it reads from far away without shouting. Kept deliberately subtle —
  // additive blending, low opacity, slow breathing pulse.
  let stopMarkers = [];
  let stopGlowTexture = null;
  function makeStopGlowTexture() {
    if (stopGlowTexture) return stopGlowTexture;
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 128;
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 128, 0, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 128);
    ctx.globalCompositeOperation = 'destination-out';
    const side = ctx.createLinearGradient(0, 0, 64, 0);
    side.addColorStop(0, 'rgba(0,0,0,1)');
    side.addColorStop(0.32, 'rgba(0,0,0,0)');
    side.addColorStop(0.68, 'rgba(0,0,0,0)');
    side.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = side;
    ctx.fillRect(0, 0, 64, 128);
    stopGlowTexture = new THREE.CanvasTexture(cv);
    stopGlowTexture.colorSpace = THREE.SRGBColorSpace;
    return stopGlowTexture;
  }

  const mother = new THREE.Mesh(MOTHER_FLOWER, motherMat);
  mother.visible = false;
  mother.userData.wx = 0;
  mother.userData.wz = 0;
  mother.castShadow = true;
  scene.add(mother);

  // Clouds: fluffy cumulus built from vertex-shaded puffs. Colors are baked
  // into the geometry (white tops, soft blue-grey bellies) with an unlit
  // material, so scene lights can never tint them green or pink. applyTheme
  // re-skins them per stage (position, size, tint) — see theme.cloud.
  const puffGeo = new THREE.SphereGeometry(1, 14, 11);
  {
    const pos = puffGeo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const top = new THREE.Color(0xffffff);
    const bottom = new THREE.Color(0xd7deeb);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp((pos.getY(i) + 1) / 2, 0, 1);
      const c = bottom.clone().lerp(top, Math.pow(t, 0.8));
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    puffGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  const puffMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  function makeCumulus() {
    const g = new THREE.Group();
    const n = 7 + Math.floor(Math.random() * 4);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const r = 4.4 + Math.random() * 2.6 - Math.abs(t - 0.5) * 3.4; // tallest mid-cloud
      const puff = new THREE.Mesh(puffGeo, puffMat);
      puff.position.set(x, r * 0.24 + Math.random() * r * 0.42, (Math.random() - 0.5) * r * 0.9);
      puff.scale.set(r, r * (0.6 + Math.random() * 0.18), r * 0.85);
      g.add(puff);
      x += r * 0.82;
    }
    const box = new THREE.Box3().setFromObject(g);
    const cx = (box.min.x + box.max.x) / 2;
    for (const p of g.children) p.position.x -= cx;
    return g;
  }
  for (let i = 0; i < 9; i++) {
    const c = makeCumulus();
    c.scale.setScalar(1.8 + Math.random() * 1.8);
    c.userData.speed = 0.35 + Math.random() * 0.65;
    // Fixed slots in a band ahead: mostly above and in front of the POV.
    c.userData.zo = -40 - Math.random() * 220;
    c.position.set((Math.random() - 0.5) * 340, 46 + Math.random() * 40, c.userData.zo);
    scene.add(c);
    clouds.push(c);
  }

// Breath: a warm whisper of air trailing along the petal's recent path.
// Soft round drifts — no hard edges, never more than a hint of opacity —
// replacing the old rectangular wind slivers that read as gray confetti.
const BREATH_N = 90;
const breathGeo = new THREE.BufferGeometry();
const bPos = new Float32Array(BREATH_N * 3);
const bSize = new Float32Array(BREATH_N);
const bAlpha = new Float32Array(BREATH_N);
breathGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
breathGeo.setAttribute('aSize', new THREE.BufferAttribute(bSize, 1));
breathGeo.setAttribute('aAlpha', new THREE.BufferAttribute(bAlpha, 1));
const breathMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aAlpha;
      varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
        vA = aAlpha;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        float d = length(gl_PointCoord - vec2(0.5));
        float soft = smoothstep(0.5, 0.06, d); // feathered disc, no rectangle
        gl_FragColor = vec4(1.0, 0.98, 0.93, soft * vA); // warm breath white
      }`,
  });
  const breathPoints = new THREE.Points(breathGeo, breathMat);
  breathPoints.frustumCulled = false;
  scene.add(breathPoints);
  const breath = [];
  for (let i = 0; i < BREATH_N; i++) {
    breath.push({ life: -1, max: 1, x: 0, y: -500, z: 0, vx: 0, vy: 0, vz: 0, s0: 0.4 });
  }

  // (Distant mountains + lakes are built per meadow inside applyTheme above,
  // using each theme's env profile.)

  let breathCursor = 0;
  let breathAcc = 0;

  const api = {
    scene,
    camera,
    renderer,
    petal,
    applyTheme,
    currentThemeIndex() { return themeIndex; },
    setBoost(v) { boostTarget = Math.max(0, Math.min(1, v || 0)); },
    setGust(v) { gustFxTarget = Math.max(0, Math.min(1, v || 0)); },
    flowerStats() {
      return { petalCount: petalColors.length, budKinds: KIND_GEOMETRIES.length };
    },
    budCounts() {
      return budMeshes.map((m) => (m ? m.count : 0));
    },
    setTrail(buds, motherPos) {
      scaleBuds(buds);
      if (motherPos) {
        mother.userData.wx = motherPos.x;
        mother.userData.wz = motherPos.z;
        mother.visible = true;
      }
    },
    collectPop(index) {
      const b = budData[index];
      if (!b) return;
      const ring = ringPool[ringCursor];
      ringCursor = (ringCursor + 1) % ringPool.length;
      ring.visible = true;
      ring.position.set(b.x, b.y, b.z);
      ring.lookAt(camera.position);
      ring.scale.setScalar(1);
      ring.material.opacity = 0.28;
      pops.push({ x: b.x, y: b.y, z: b.z, life: 0, ring });
      budTimes[index] = 0;
    },
    setPetalSize(s) {
      // Global size trim: the game's growth mechanic still applies, but the
      // petals render smaller so the trailing ribbon of collected colours
      // stays readable on screen.
      petal.scale.setScalar(s * 0.55);
    },
    addPetal(hex, from = null) {
      if (petalColors.length >= MAX_PETALS) {
        // At the cap: drop the oldest petal, keep the rest, add the newest.
        const oldest = petalMeshes.shift();
        petalRing.remove(oldest);
        oldest.material.dispose();
        petalMats.shift();
        petalColors.shift();
      }
      petalColors.push(hex);
      curPetalColor = hex; // glow the grass beneath with the newest petal colour
      spawnPetalMesh(from); // only the new petal animates — the swarm stays put
    },
    setPetalCount(n) {
      const cur = petalColors[petalColors.length - 1] ?? 0xff9ec6;
      petalColors = Array.from({ length: Math.max(1, Math.min(MAX_PETALS, n)) }, () => cur);
      rebuildPetals();
    },
    setPetalGlow(progress) {
      currentGlow = Math.min(1, Math.max(0, progress));
      for (const mat of petalMats) mat.uniforms.uGlow.value = currentGlow * 0.6;
    },
    // Swap in the loaded 3D petal (CC-BY cherry blossom). Applied to every
    // petal on the next rebuild; the procedural one is used until then.
    setPetalGeometry(geo) {
      const count = geo.getAttribute('position').count;
      if (!geo.getAttribute('color')) {
        const col = new Float32Array(count * 3).fill(1.0);
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      }
      if (!geo.getAttribute('aThick')) {
        geo.setAttribute('aThick', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1.0), 1));
      }
      if (!geo.getAttribute('aAo')) {
        geo.setAttribute('aAo', new THREE.Float32BufferAttribute(new Float32Array(count).fill(1.0), 1));
      }
      petalGeometry = geo;
    },
    // Reset the trail slots (called on teleport / new meadow / start so the
    // ribbon never stretches through stale world positions).
    resetTrail() {
      trailHistory.length = 0;
    },
    // How many buds have finished their bloom-on-pass (for tests/debug).
    budsOpened() {
      return budOpen.reduce((n, v) => n + (v > 0.9 ? 1 : 0), 0);
    },
    setStopMarkers(points) {
      for (const s of stopMarkers) {
        scene.remove(s);
        s.material.dispose();
      }
      stopMarkers = [];
      if (!points) return;
      const tex = makeStopGlowTexture();
      points.forEach((p, i) => {
        const mat = new THREE.SpriteMaterial({
          map: tex,
          color: p.color ?? 0xfff1d6,
          transparent: true,
          opacity: 0.14,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false
        });
        const s = new THREE.Sprite(mat);
        s.position.set(p.x, p.y + 5, p.z);
        s.scale.set(3.2, 11, 1);
        s.userData.phase = i * 1.7;
        scene.add(s);
        stopMarkers.push(s);
      });
    },
    frame(dt, petalPos, bank, timeSec, steerLevel = 0) {
      nowSec = timeSec;
      // Beacon breathing: barely-there pulse so the column feels alive.
      for (const s of stopMarkers) {
        s.material.opacity = 0.1 + 0.06 * (0.5 + 0.5 * Math.sin(timeSec * 1.3 + s.userData.phase));
      } // keep the acquisition clock current
      petal.position.set(petalPos.x, petalPos.y, petalPos.z);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;
      // Wind intensity eases toward the steering input.
      windIntensity = Math.min(1, windIntensity + (steerLevel - windIntensity) * Math.min(1, dt * 1.1));

      // Altitude-aware fog: when the petal rides a gust into the sky the
      // meadow must stay detailed out to the new horizon. Scale the theme's
      // fog far by the same altitude factor the grass domains use, so ground
      // detail and haze move together instead of the grass extending into a
      // fog bank.
      {
        const alt = Math.max(0, petalPos.y - HILLS.height(petalPos.x, petalPos.z));
        const fogScale = Math.min(3.5, 1 + Math.max(0, alt - 3.6) * 0.13);
        const fNear = Math.min(themeFogFar - 10, themeFogNear * (1 + (fogScale - 1) * 0.25));
        const fFar = themeFogFar * fogScale;
        scene.fog.near = fNear;
        scene.fog.far = fFar;
        terrainMat.uniforms.fogNear.value = fNear;
        terrainMat.uniforms.fogFar.value = fFar;
      }
      // Trail: record the recent path, spaced ~2.5 units apart so slots
      // stretch a real distance behind the player (not every frame collapsed
      // at one point).
      {
        const last = trailHistory[0];
        if (!last || Math.hypot(last.x - petalPos.x, last.z - petalPos.z) > 3.2) {
          trailHistory.unshift({ x: petalPos.x, y: petalPos.y, z: petalPos.z });
          if (trailHistory.length > 40) trailHistory.pop();
        }
      }
      const wind = windAt(timeSec, 11);
      const windBias = Math.max(-1, Math.min(1, wind.swayVx));
      // First few petals swirl in a circle around the player; the rest trail
      // behind in a loose spiral stream.
      const RING_PETALS = 3;
      for (let i = 0; i < petalMeshes.length; i++) {
        const m = petalMeshes[i];
        const u = m.userData;
        let ease = 1;
        if (u.born >= 0) {
          const age = timeSec - u.born;
          const k = Math.min(1, age / 1.0);
          ease = k * k * (3 - 2 * k);
        }
        // Hybrid: the first RING_PETALS petals swirl in a 3D circle around
        // the player (wind wreath); the rest trail behind in a loose spiral.
        let px, py, pz;
        if (i < RING_PETALS) {
          const a = u.orbit + timeSec * (0.5 + windIntensity * 0.4);
          const rad = u.radius0 * (1 + 0.1 * Math.sin(timeSec * u.breathe + u.ph0));
          px = Math.cos(a) * rad;
          py = Math.sin(a) * rad * u.flat + 0.18 * Math.sin(timeSec * u.tumble + u.ph0);
          pz = u.z0 + Math.sin(timeSec * 1.1 + a * 2) * u.zdepth * 0.35;
        } else {
          const tIdx = i - RING_PETALS;
          // Tighter spacing so the whole collected ribbon stays on screen:
          // a string of many small petals instead of a few large ones.
          const lag = 1.7 + tIdx * 1.55;
          const spiral = 0.42 + tIdx * 0.07;
          px = Math.cos(u.orbit + timeSec * 0.8) * spiral + windBias * 0.8;
          py = Math.sin(u.orbit * 1.7 + timeSec * 0.7) * 0.26 + Math.cos(u.ph0 + timeSec * 0.5) * 0.24;
          pz = lag;
        }
        // Fresh pickup: the new petal FLIES IN from the flower it came from.
        // Slow and lazy — it detaches, floats across on the breeze with a
        // soft arc, and settles into its slot. No speed, no spin: nothing
        // that could read as sharp or hurried.
        let flying = false;
        let flyE = 1;
        if (u.flyFrom) {
          const fk = Math.min(1, (timeSec - u.flyT0) / 1.6);
          if (fk < 1) {
            flying = true;
            flyE = 1 - Math.pow(1 - fk, 3); // decelerate gently into place
            const arc = Math.sin(fk * Math.PI) * 0.5;
            const sway = Math.sin(fk * Math.PI * 2) * 0.12; // drifting, not darting
            px = lerp(u.flyFrom.x, px, flyE) + sway;
            py = lerp(u.flyFrom.y, py, flyE) + arc;
            pz = lerp(u.flyFrom.z, pz, flyE);
          } else {
            delete u.flyFrom; // landed — normal orbit behaviour takes over
          }
        }
        if (flying) {
          // Direct placement along the flight path (no lag-lerp), growing in
          // softly and tilting as it settles onto the wreath.
          const wx = petalPos.x + px;
          const wz = petalPos.z + pz;
          const fy = HILLS.height(wx, wz) + 0.45;
          m.position.set(px, Math.max(fy, py), pz);
          m.scale.setScalar(lerp(0.3, 1, flyE));
          m.rotation.x = u.basePitch + Math.sin(flyE * Math.PI) * 0.35;
          m.rotation.y = u.baseYaw + Math.sin(timeSec * 1.2 + u.ph0) * 0.12;
          m.rotation.z = u.baseRoll + Math.sin(flyE * Math.PI) * 0.4;
          u.worldX = wx;
          u.worldY = m.position.y;
          u.worldZ = wz;
          continue;
        }
        const targetY = lerp(m.position.y, py, Math.min(1, dt * 4) * ease);
        // Never clip the ground: petals hold at least half a petal above the
        // terrain under them (world position = petal grouping + local offset).
        const worldX = petalPos.x + lerp(m.position.x, px, Math.min(1, dt * 4) * ease);
        const worldZ = petalPos.z + lerp(m.position.z, pz, Math.min(1, dt * 4) * ease);
        const floorY = HILLS.height(worldX, worldZ) + 0.45;
        const finalY = Math.max(floorY, targetY);
        const pwx = lerp(m.position.x, px, Math.min(1, dt * 4) * ease);
        const pwz = lerp(m.position.z, pz, Math.min(1, dt * 4) * ease);
        m.position.set(pwx, finalY, pwz);
        m.scale.setScalar((0.5 + ease * 0.5) * (1 + windIntensity * 0.18));
        m.rotation.x = u.basePitch + windBias * 0.18 + Math.sin(timeSec * 1.4 + u.ph0) * 0.06;
        m.rotation.y = u.baseYaw + Math.sin(timeSec * 1.1 + u.ph0 * 2) * 0.08;
        m.rotation.z = u.baseRoll + Math.sin(timeSec * 0.9 + u.ph0) * 0.1;
        // Store the petal's world position for the depth fade (computed after
        // the camera moves this frame, at the bottom of frame()).
        u.worldX = petalPos.x + pwx;
        u.worldY = finalY;
        u.worldZ = petalPos.z + pwz;
      }

      // Terrain & Grass shader uniforms update (zero per-instance CPU loop)
      terrainMat.uniforms.uCameraPos.value.copy(camera.position);
      terrainMat.uniforms.uTime.value = timeSec;
      flowerCrownMat.uniforms.uCameraPos.value.copy(camera.position);
      stemMat.uniforms.uCameraPos.value.copy(camera.position);
      motherMat.uniforms.uCameraPos.value.copy(camera.position);
      for (const mat of petalMats) {
        mat.uniforms.uCameraPos.value.copy(camera.position);
      }
      grass.update(timeSec, petalPos, bank, wind, camera.position, petalColorVec.setHex(curPetalColor));

      // Sun and shadow follow the player smoothly down the meadow
      sun.position.set(petalPos.x + 40, 70, petalPos.z + 25);
      sun.target.position.set(petalPos.x, petalPos.y, petalPos.z);

      // Flowers: planted on the terrain in true world coords (meshes at origin).
      if (budMeshes.length) {
        const dummy = budDummy;
        for (let i = 0; i < budData.length; i++) {
          const b = budData[i];
          if (!b) continue;
          const kind = (b.kind ?? 0) % KIND_GEOMETRIES.length;
          const mesh = budMeshes[kind];
          if (!mesh) continue;
          const local = budLocal[i];
          const ground = HILLS.height(b.x, b.z);
          const crownY = ground + CROWN_LIFT;
          const stemMesh = stemMeshes[kind];
          if (budTimes[i] !== null) {
            budTimes[i] += dt;
            const kt = budTimes[i] / 0.25;
            if (budTimes[i] > 0.25) {
              dummy.position.set(b.x, -500, b.z);
              dummy.scale.setScalar(0.001);
              if (stemMesh) {
                stemDummy.position.set(b.x, ground, b.z);
                stemDummy.rotation.set(0, 0, 0);
                stemDummy.scale.set(1, 0.001, 1);
                stemDummy.updateMatrix();
                stemMesh.setMatrixAt(local, stemDummy.matrix);
              }
            } else {
              const sc = (1 - kt) * KIND_SCALE[kind] * (b.scale ?? 1);
              dummy.position.set(b.x, crownY, b.z);
              dummy.scale.setScalar(sc);
              dummy.rotation.set(b.faceTiltX ?? 0, b.faceYaw ?? 0, b.faceTiltZ ?? 0);
              if (stemMesh) {
                stemDummy.position.set(b.x, ground, b.z);
                stemDummy.rotation.set(0, 0, 0);
                stemDummy.scale.set(1, STEM_LEN * (1 - kt), 1);
                stemDummy.updateMatrix();
                stemMesh.setMatrixAt(local, stemDummy.matrix);
              }
            }
          } else {
            // Bloom-on-pass: ease this bud's openness toward its target.
            // Close petal => open; once open it stays open for the visit.
            if (budOpen[i] < 1) {
              const d = Math.hypot(b.x - petalPos.x, b.z - petalPos.z);
              const want = THREE.MathUtils.clamp(1 - (d - BLOOM_NEAR) / (BLOOM_FAR - BLOOM_NEAR), 0, 1);
              budOpen[i] = Math.min(1, budOpen[i] + Math.max(want, 0) * dt * 1.4);
            }
            const open = budOpen[i];
            // Closed buds still read as flowers: a generous floor scale and
            // only a slight sink keep petal shapes visible across the meadow
            // (they were dots at the old 42% floor).
            const sc = (0.95 + 0.05 * open) * (1 + Math.sin(timeSec * 2.5 + i) * 0.05 * open);
            dummy.position.set(b.x, crownY - (1 - open) * 0.18, b.z);
            dummy.scale.setScalar(sc * KIND_SCALE[kind] * (b.scale ?? 1));
            // Each plant keeps its own gentle nod and a compass spin (petals rotate
            // around the vertical); crowns face the sky, never the camera.
            dummy.rotation.set(
              (b.faceTiltX ?? 0) + Math.sin(timeSec * 0.9 + i) * 0.06 * open,
              b.faceYaw ?? 0,
              (b.faceTiltZ ?? 0) + Math.sin(timeSec * 0.6 + i * 1.7) * 0.12 * open
            );
            if (stemMesh) {
              stemDummy.position.set(b.x, ground, b.z);
              stemDummy.rotation.set(0, 0, Math.sin(timeSec * 1.6 + i) * 0.04 * open); // gentle sway
              stemDummy.scale.set(0.7 + 0.3 * open, STEM_LEN * (0.55 + 0.45 * open), 0.7 + 0.3 * open);
              stemDummy.updateMatrix();
              stemMesh.setMatrixAt(local, stemDummy.matrix);
            }
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(local, dummy.matrix);
        }
        for (const m of budMeshes) { if (m) m.instanceMatrix.needsUpdate = true; }
        for (const m of stemMeshes) { if (m) m.instanceMatrix.needsUpdate = true; }
      }

      // Pops: a whisper of a ring — just enough to confirm the pickup.
      for (let i = pops.length - 1; i >= 0; i--) {
        const pop = pops[i];
        pop.life += dt;
        const k = Math.min(1, pop.life / 0.42);
        pop.ring.scale.setScalar(1 + k * 2.1);
        pop.ring.material.opacity = 0.28 * (1 - k) * (1 - k);
        if (pop.life > 0.42) {
          pop.ring.visible = false;
          pops.splice(i, 1);
        }
      }

      // Mother bloom: ride the terrain + pulse in true world coords.
      if (mother.visible) {
        const m = 1 + Math.sin(timeSec * 1.8) * 0.08;
        mother.scale.setScalar(m);
        mother.rotation.y += dt * 0.4; // spin petals around the upright crown
        mother.position.set(
          mother.userData.wx,
          HILLS.height(mother.userData.wx, mother.userData.wz) + 3.4,
          mother.userData.wz
        );
      }

      // Sky + clouds track the camera.
      sky.position.copy(camera.position);
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 190) c.position.x = -190;
        c.position.z = camera.position.z + c.userData.zo;
      }

// Distant mountains + lakes ride with the camera, like the clouds —
// a horizon backdrop, not ground the petal flies over.
if (envMountains) envMountains.position.set(camera.position.x, 0, camera.position.z);
if (envLakes) envLakes.position.set(camera.position.x, 0, camera.position.z);

// Breath trail: emit soft drifts along the petal's recent path. The
// breath deepens as the basket fills — a fuller day breathes harder.
// Each puff rises lazily, leans with the wind, and fades in/out on a
// sine envelope that peaks around a gentle 0.13 alpha.
breathAcc += dt * (5 + petalMeshes.length * 0.8) * (1 + gustFx * 6);
while (breathAcc >= 1) {
  breathAcc -= 1;
  const p = breath[breathCursor];
  breathCursor = (breathCursor + 1) % BREATH_N;
  const t = trailHistory[Math.min(trailHistory.length - 1, Math.floor(Math.random() * 3))]
    || { x: petalPos.x, y: petalPos.y, z: petalPos.z };
  p.life = 0;
  p.max = 2.6 + Math.random() * 1.2;
  p.x = t.x + (Math.random() - 0.5) * 0.7;
  p.y = t.y + (Math.random() - 0.5) * 0.5 + 0.15;
  p.z = t.z + (Math.random() - 0.5) * 0.7;
  p.vx = windBias * 0.45 + (Math.random() - 0.5) * 0.14;
  p.vy = 0.16 + Math.random() * 0.12;
  p.vz = (Math.random() - 0.5) * 0.1;
  p.s0 = (0.32 + Math.random() * 0.22) * (1 + gustFx * 0.6);
      }
      for (let i = 0; i < BREATH_N; i++) {
        const p = breath[i];
        if (p.life < 0) { bAlpha[i] = 0; continue; }
        p.life += dt;
        if (p.life >= p.max) { p.life = -1; bAlpha[i] = 0; continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const k = p.life / p.max;
        bAlpha[i] = Math.sin(k * Math.PI) * (0.13 + gustFx * 0.12);
        bSize[i] = p.s0 * (1 + k * 1.6); // swells as it dissolves
        bPos[i * 3] = p.x;
        bPos[i * 3 + 1] = p.y;
        bPos[i * 3 + 2] = p.z;
      }
      breathGeo.attributes.position.needsUpdate = true;
      breathGeo.attributes.aSize.needsUpdate = true;
      breathGeo.attributes.aAlpha.needsUpdate = true;

      // Camera glides ALWAYS forward, fixed distance behind the petal. It
      // never zooms or steps back — the only "motion" beyond the glide is the
      // gentle fov breathing below, which keeps the grass stable on screen.
      const camTarget = new THREE.Vector3(
        petalPos.x * 0.6,
        petalPos.y * 0.55 + 4.2,
        petalPos.z + 15
      );
      camera.position.lerp(camTarget, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30);
      // Weightless drift: a very slow horizon roll and gentle FOV breathing
      // so cruising never feels locked on rails. Periods are long (20-30s)
      // and amplitudes tiny — felt more than seen.
      camera.rotation.z += Math.sin(timeSec * 0.29) * 0.03 + Math.sin(timeSec * 0.83) * 0.008;
      boostLevel += (boostTarget - boostLevel) * Math.min(1, dt * 3);
      gustFx += (gustFxTarget - gustFx) * Math.min(1, dt * 3);
      camera.fov = 60 + Math.sin(timeSec * 0.21) * 1.3 + boostLevel * 5;
      camera.updateProjectionMatrix();
      // Shadow map refreshes at ~20Hz (see shadowMap.autoUpdate above).
      if ((frameNo++ % 3) === 0) renderer.shadowMap.needsUpdate = true;

      // Proximity: petals near the camera fade toward translucent, graduating
      // smoothly across the band. The default POV puts ring petals ~15 units
      // from the camera and the trail streams 12–25 out, so the band is wide
      // (6–20) to actually be visible during play, not just on a head-on
      // dive into the lens.
      const FADE_NEAR = 5;
      const FADE_FAR = 18;
      for (let i = 0; i < petalMeshes.length; i++) {
        const m = petalMeshes[i];
        const u = m.userData;
        if (u.worldX === undefined) continue;
        const camDist = Math.hypot(
          camera.position.x - u.worldX,
          camera.position.y - u.worldY,
          camera.position.z - u.worldZ
        );
        const alpha = Math.min(1, Math.max(0, (camDist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
        // Small petals stay readable: higher opacity floor and a gentler
        // fade so the ribbon reads as solid colour, not mist.
        m.material.uniforms.uOpacity.value = 0.22 + 0.78 * Math.pow(alpha, 0.8);
      }
    },
  };

  function scaleBuds(buds) {
    budData = buds;
    budTimes = buds.map(() => null);
    budOpen = buds.map(() => 0); // all closed at the start of a visit
    budLocal = buds.map(() => 0);
    const perKind = KIND_GEOMETRIES.map(() => []);
    buds.forEach((b, i) => {
      const k = (b.kind ?? 0) % perKind.length;
      perKind[k].push(i);
    });
    for (const m of budMeshes) {
      if (!m) continue;
      scene.remove(m);
      // Do NOT dispose m.geometry: KIND_GEOMETRIES are shared across stages.
      // Disposing one breaks the next stage's flowers (missing meadow).
    }
    budMeshes = [];
    for (const m of stemMeshes) {
      if (!m) continue;
      scene.remove(m);
      // STEM_GEO is shared too — same rule.
    }
    stemMeshes = [];
    perKind.forEach((indices, k) => {
      if (!indices.length) return;
      const mesh = new THREE.InstancedMesh(
        KIND_GEOMETRIES[k],
        flowerCrownMat,
        indices.length
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      indices.forEach((idx, local) => {
        budLocal[idx] = local;
        mesh.setColorAt(local, new THREE.Color(buds[idx].colorHex));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      scene.add(mesh);
      budMeshes[k] = mesh;

      // A stem beneath each crown of this kind.
      const stems = new THREE.InstancedMesh(STEM_GEO, stemMat, indices.length);
      stems.frustumCulled = false;
      const sd = new THREE.Object3D();
      indices.forEach((idx, local) => {
        const b = buds[idx];
        sd.position.set(b.x, HILLS.height(b.x, b.z), b.z);
        sd.scale.set(1, STEM_LEN, 1);
        sd.updateMatrix();
        stems.setMatrixAt(local, sd.matrix);
        // Per-instance flower colour: the shader tints the stem's top with
        // its own bloom so stem and crown read as one plant.
        stems.setColorAt(local, new THREE.Color(buds[idx].colorHex));
      });
      if (stems.instanceColor) stems.instanceColor.needsUpdate = true;
      scene.add(stems);
      stemMeshes[k] = stems;
    });
  }

  rebuildPetals();
  api.setPetalCount(1);
  api.setPetalGlow(0);
  return api;
}

export function resize(api) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  api.renderer.setSize(w, h);
  api.camera.aspect = w / h;
  api.camera.updateProjectionMatrix();
}