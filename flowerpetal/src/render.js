import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS } from './trail.js';
import { HILLS } from './hill.js';
import { windAt } from './wind.js';
import { createGrass } from './grass.js?v=6';

export const SKY_TOP = 0x529ef0;
export const SKY_BOTTOM = 0xc8e6ff;

// --- Botanical Shading for Flowers, Stems, and Petals (Matching Grass SSS + Sun + Sky + Fog) ---
const FLOWER_VERTEX_SHADER = `
  precision highp float;

  attribute vec3 color;
  attribute float aCenter;

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;
  varying vec3 vInstanceColor;

  void main() {
    vColor = color;
    vCenter = aCenter;
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

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    // Warm golden-amber pollen stamen center; petals take vibrant instance color with organic petal gradient
    vec3 pollenColor = vec3(1.15, 0.88, 0.28);
    vec3 baseColor = mix(vInstanceColor * vColor, pollenColor * vColor, vCenter);

    // Organic botanical lighting (harmonious with grass):
    // Wrapped diffuse keeps shaded sides airy so pastels never go muddy.
    float nDotL = max(0.0, dot(vNormal, sunDir) * 0.5 + 0.5);

    // Translucent Subsurface Scattering (sunlight filtering through petal membranes)
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * (0.55 * (1.0 - vCenter * 0.45));

    // Hemispheric sky fill (bright floor = happy pastel read)
    vec3 skyLight = vec3(0.78, 0.90, 1.0) * (0.58 + 0.28 * max(0.0, vNormal.y));

    // Sun light with warm golden tone
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.48 + sss);

    // Soft velvety rim sheen (Fresnel)
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.8) * 0.32;

    vec3 finalColor = baseColor * (skyLight + sunLight) + vec3(1.0, 0.96, 0.88) * fresnel;

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

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;
  varying float vCenter;

  void main() {
    vColor = color;
    vCenter = aCenter;

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

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    vec3 pollenColor = vec3(1.18, 0.92, 0.32);
    vec3 baseColor = mix(uColor * vColor, pollenColor * vColor, vCenter);

    float nDotL = max(0.0, dot(vNormal, sunDir));
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * (0.34 * (1.0 - vCenter * 0.45));

    vec3 skyLight = vec3(0.75, 0.88, 1.0) * (0.26 + 0.26 * max(0.0, vNormal.y));
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.55 + sss);

    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.8) * 0.22;

    vec3 emissive = uColor * 0.14;
    vec3 finalColor = baseColor * (skyLight + sunLight) + emissive + vec3(1.0, 0.96, 0.88) * fresnel;

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

  varying vec3 vWorldPos;
  varying vec3 vNormal;
  varying vec3 vColor;

  void main() {
    vColor = color;

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

  void main() {
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    vec3 sunDir = normalize(uSunDir);

    vec3 baseColor = uColor * vColor;

    // Wrapped diffuse keeps shaded sides airy so pastels never go muddy.
    float nDotL = max(0.0, dot(vNormal, sunDir) * 0.5 + 0.5);

    // Translucent Subsurface Scattering (golden backlighting through petal)
    float sss = pow(max(0.0, dot(-vNormal, sunDir)), 2.0) * 0.65;

    vec3 skyLight = vec3(0.78, 0.90, 1.0) * (0.58 + 0.28 * max(0.0, vNormal.y));
    vec3 sunLight = vec3(1.0, 0.94, 0.78) * (nDotL * 0.48 + sss);

    // Velvet rim sheen (Fresnel)
    float fresnel = pow(1.0 - max(0.0, dot(vNormal, viewDir)), 2.6) * 0.45;

    // Constant pastel floor + emissive glow ramp on collection
    vec3 emissive = uColor * 0.16 + uColor * (0.10 + uGlow * 0.30);

    vec3 finalColor = baseColor * (skyLight + sunLight) + emissive + vec3(1.0, 0.96, 0.90) * fresnel;

    // Atmospheric distance fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    fogFactor = pow(fogFactor, 1.2);
    finalColor = mix(finalColor, fogColor, fogFactor);

    gl_FragColor = vec4(finalColor, uOpacity);
  }
`;

// A petal as a rounded teardrop: stretched blob, tapered toward the crown,
// used in two layers so blooms read as organic petals instead of blobby
// spheres. Higher segment counts for a smooth silhouette.
function teardropPetal(len, wide, thin = 0.3) {
  const g = new THREE.SphereGeometry(len, 14, 10);
  g.scale(wide, wide * 0.62, thin);
  g.rotateZ(0); // long axis along +x before being rotated per-petal
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const centers = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const span = Math.max(0.01, len * wide * 2);
    const t = THREE.MathUtils.clamp((x + len * wide) / span, 0, 1);
    const bright = 0.82 + t * 0.28;
    colors[i * 3] = bright;
    colors[i * 3 + 1] = bright * 0.98;
    colors[i * 3 + 2] = bright * 0.95;
    centers[i] = 0.0;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('aCenter', new THREE.Float32BufferAttribute(centers, 1));
  return g;
}

function buildFlowerGeometry({ petalRadius = 0.5, centerRadius = 0.26, petals = 5, spread = 1.0 } = {}) {
  const parts = [];
  // Two overlapping petal layers, each rotated by half a petal, so the bloom
  // looks like real layered petals rather than a ball with bumps.
  for (let layer = 0; layer < 2; layer++) {
    for (let i = 0; i < petals; i++) {
      const a = ((i + layer * 0.5) / petals) * Math.PI * 2;
      const g = teardropPetal(petalRadius * 0.9, 0.5, 0.3);
      g.rotateZ(a);
      g.translate(
        Math.cos(a) * petalRadius * 1.05 * spread,
        Math.sin(a) * petalRadius * 1.05 * spread,
        (layer === 0 ? 0 : -0.12) // back layer slightly higher
      );
      parts.push(g);
    }
  }
  // Fuzzy center: a small, denser sphere with a crown bump.
  const heart = new THREE.SphereGeometry(centerRadius, 12, 9);
  heart.scale(1, 1, 0.9);
  const hpos = heart.attributes.position;
  const hcolors = new Float32Array(hpos.count * 3);
  const hcenters = new Float32Array(hpos.count);
  for (let i = 0; i < hpos.count; i++) {
    hcolors[i * 3] = 1.0;
    hcolors[i * 3 + 1] = 0.82;
    hcolors[i * 3 + 2] = 0.32;
    hcenters[i] = 1.0;
  }
  heart.setAttribute('color', new THREE.Float32BufferAttribute(hcolors, 3));
  heart.setAttribute('aCenter', new THREE.Float32BufferAttribute(hcenters, 1));
  parts.push(heart);
  return mergeGeometries(parts);
}

const KIND_GEOMETRIES = FLOWER_KINDS.map((k) =>
  buildFlowerGeometry({ petalRadius: 0.5, centerRadius: k.bigCenter, petals: k.petals, spread: k.spread })
);
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.15, centerRadius: 0.5, petals: 8, spread: 1.25 });

// A slender stem for the collectible flowers: tapered green cylinder rising
// from the ground to the flower crown. Bases at y=0 (lives in world space).
const STEM_GEO = new THREE.CylinderGeometry(0.03, 0.05, 1, 6);
STEM_GEO.translate(0, 0.5, 0);
{
  const spos = STEM_GEO.attributes.position;
  const scol = new Float32Array(spos.count * 3);
  // Fresh yellow-green: darker where the stem meets its shadow in the grass,
  // brightening toward the crown so stems never read as black sticks.
  const root = new THREE.Color(0x4a722f);
  const top = new THREE.Color(0xa9cf6d);
  for (let i = 0; i < spos.count; i++) {
    const y = spos.getY(i);
    const c = root.clone().lerp(top, THREE.MathUtils.clamp(y, 0, 1));
    scol[i * 3] = c.r;
    scol[i * 3 + 1] = c.g;
    scol[i * 3 + 2] = c.b;
  }
  STEM_GEO.setAttribute('color', new THREE.Float32BufferAttribute(scol, 3));
}
const STEM_LEN = 3.2;
const CROWN_LIFT = STEM_LEN + 0.35; // crown height above the terrain (stands above grass)

// Player petal: an elongated, tapered blade along Z (flight direction) — a
// wider rounded tip and narrower base, like a real flower petal rather than
// a plain pill.
const PETAL_GEO = new THREE.SphereGeometry(0.2, 14, 10);
PETAL_GEO.scale(0.3, 0.62, 1.6);
{
  const pos = PETAL_GEO.attributes.position;
  const pcol = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 1.6; // -1..1 along the blade
    // taper width toward the base (z = -1) and round the tip (z = +1)
    const taper = 0.45 + 0.55 * Math.pow(0.5 + z * 0.5, 0.7);
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, pos.getY(i) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, Math.max(0, (z + 1) / 2)))));
    const t = THREE.MathUtils.clamp((z + 1) / 2, 0, 1);
    const bright = 0.85 + t * 0.22;
    pcol[i * 3] = bright;
    pcol[i * 3 + 1] = bright;
    pcol[i * 3 + 2] = bright;
  }
  PETAL_GEO.setAttribute('color', new THREE.Float32BufferAttribute(pcol, 3));
  PETAL_GEO.computeVertexNormals();
}
export const MAX_PETALS = 8;
const PETAL_RING_R = 0.3;

const KIND_SCALE = [1.0, 1.05, 0.92, 1.1];

// Linear interpolation helper (the frame eases petals toward their slot).
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2.0));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 75, 380);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, 40);

  // Sky dome.
  const skyGeo = new THREE.SphereGeometry(500, 24, 12);
  const skyPos = skyGeo.attributes.position;
  const skyColors = [];
  const top = new THREE.Color(SKY_TOP);
  const bottom = new THREE.Color(SKY_BOTTOM);
  for (let i = 0; i < skyPos.count; i++) {
    const t = THREE.MathUtils.clamp(skyPos.getY(i) / 500, 0, 1);
    skyColors.push(top.r * t + bottom.r * (1 - t), top.g * t + bottom.g * (1 - t), top.b * t + bottom.b * (1 - t));
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  scene.add(sky);

  // --- Infinite Dynamic GPU Terrain: A continuous rolling landscape generated
  // dynamically on the GPU. Centered on the camera and snapped to the grid so
  // it extends infinitely in all directions with zero seams or disappearing edges.
  const hp = HILLS.params;
  const terrainGeo = new THREE.PlaneGeometry(900, 900, 160, 160);
  terrainGeo.rotateX(-Math.PI / 2);

  const terrainMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uCameraPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
      uHillsParams1: { value: new THREE.Vector4(hp.a1, hp.f1x, hp.p1x, hp.f1z) },
      uHillsParams2: { value: new THREE.Vector4(hp.p1z, hp.b1, hp.f2x, hp.p2x) },
      uHillsParams3: { value: new THREE.Vector4(hp.f2z, hp.p2z, hp.offset, 0) },
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

  // --- Buds (one InstancedMesh per kind, child of world) ---
  let budMeshes = [];
  let stemMeshes = [];
  let budData = [];
  let budTimes = [];
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
  // material, so scene lights can never tint them green or pink. They sit
  // high and AHEAD of the flight path — you see part of a cloud, naturally.
  const clouds = [];
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

  // Wind streaks: a handful of very thin, faint light lines that stream with
  // the travel direction. Deliberately sparse and slim — a whisper of air,
  // not white bars.
  const STREAK_N = 10;
  const streakGeo = new THREE.PlaneGeometry(0.09, 0.9, 1, 1); // thin slivers
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xfff6e8,
    transparent: true,
    opacity: 0.06,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
  });
  const streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, STREAK_N);
  streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  streakMesh.frustumCulled = false;
  const streakSeeds = [];
  for (let i = 0; i < STREAK_N; i++) {
    streakSeeds.push({
      ang: (i / STREAK_N) * Math.PI * 2 + Math.random() * 0.5,
      spin: 0.3 + Math.random() * 0.3,
      r: 1.6 + Math.random() * 1.6,
      yoff: (Math.random() - 0.5) * 1.6,
      progress: Math.random(), // 0 (at petal) .. 1 (at camera)
    });
  }
  scene.add(streakMesh);

  const api = {
    scene,
    camera,
    renderer,
    petal,
    flowerStats() {
      return { petalCount: petalColors.length, budKinds: KIND_GEOMETRIES.length };
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
      petal.scale.setScalar(s);
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
      if (!geo.getAttribute('color')) {
        const count = geo.getAttribute('position').count;
        const col = new Float32Array(count * 3).fill(1.0);
        geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      }
      petalGeometry = geo;
      for (const m of petalMeshes) m.geometry = geo;
    },
    // Reset the trail slots (called on teleport / new meadow / start so the
    // ribbon never stretches through stale world positions).
    resetTrail() {
      trailHistory.length = 0;
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
          const lag = 2.4 + tIdx * 2.6;
          const spiral = 0.5 + tIdx * 0.1;
          px = Math.cos(u.orbit + timeSec * 0.8) * spiral + windBias * 0.8;
          py = Math.sin(u.orbit * 1.7 + timeSec * 0.7) * 0.3 + Math.cos(u.ph0 + timeSec * 0.5) * 0.3;
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
        const dummy = new THREE.Object3D();
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
                const sd = new THREE.Object3D();
                sd.position.set(b.x, ground, b.z);
                sd.scale.set(1, 0.001, 1);
                sd.updateMatrix();
                stemMesh.setMatrixAt(local, sd.matrix);
              }
            } else {
              const sc = (1 - kt) * KIND_SCALE[kind];
              dummy.position.set(b.x, crownY, b.z);
              dummy.scale.setScalar(sc);
              if (stemMesh) {
                const sd = new THREE.Object3D();
                sd.position.set(b.x, ground, b.z);
                sd.scale.set(1, STEM_LEN * (1 - kt), 1);
                sd.updateMatrix();
                stemMesh.setMatrixAt(local, sd.matrix);
              }
            }
          } else {
            const sc = 1 + Math.sin(timeSec * 2.5 + i) * 0.06;
            dummy.position.set(b.x, crownY, b.z);
            dummy.scale.setScalar(sc * KIND_SCALE[kind]);
            if (stemMesh) {
              const sd = new THREE.Object3D();
              sd.position.set(b.x, ground, b.z);
              sd.rotation.z = Math.sin(timeSec * 1.6 + i) * 0.04; // gentle sway
              sd.scale.set(1, STEM_LEN, 1);
              sd.updateMatrix();
              stemMesh.setMatrixAt(local, sd.matrix);
            }
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(local, dummy.matrix);
        }
        for (const m of budMeshes) m.instanceMatrix.needsUpdate = true;
        for (const m of stemMeshes) m.instanceMatrix.needsUpdate = true;
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
        mother.rotation.z += dt * 0.4;
        mother.position.set(
          mother.userData.wx,
          HILLS.height(mother.userData.wx, mother.userData.wz) + 1.8,
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

      // Wind streaks: linear flow along the travel direction. When the player
      // banks (windIntensity up), the air rushes past visibly faster — the
      // slivers stream along the axis at a speed proportional to the steering,
      // and they lean/slip back so the motion reads as sustained rush.
      const flowSpeed = 2.0 + windIntensity * 7; // world units/s along flow
      if (streakMat) {
        const dirX = camera.position.x - petalPos.x;
        const dirZ = camera.position.z - petalPos.z;
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        const ex = dirX / dirLen;
        const ez = dirZ / dirLen;
        const sDummy = new THREE.Object3D();
        for (let i = 0; i < STREAK_N; i++) {
          const s = streakSeeds[i];
          // Each sliver has a flow progress along the petal->camera axis;
          // advance it with the wind speed and wrap it back to the petal.
          s.progress += (flowSpeed * dt) / (s.r * 1.2 + 1.5);
          if (s.progress > 1) {
            s.progress = 0;
            s.ang = Math.random() * Math.PI * 2;
          }
          const latX = Math.cos(s.ang + timeSec * s.spin) * (0.7 + s.r * 0.3);
          const latY = Math.sin(s.ang * 1.7 + timeSec * s.spin * 0.8) * 0.5 + s.yoff;
          const pxw = petalPos.x + ex * s.progress * dirLen * 0.8 + latX;
          const pzw = petalPos.z + ez * s.progress * dirLen * 0.8 + Math.sin(s.ang * 2 + timeSec * 0.7) * 0.4;
          sDummy.position.set(pxw, petalPos.y + latY, pzw);
          // Long axis along the flow; faster flow streaks lean more.
          sDummy.quaternion.setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(ex, 0, ez).normalize()
          );
          sDummy.rotateZ(Math.sin(s.ang * 3 + timeSec * 1.1) * (0.12 + windIntensity * 0.3));
          sDummy.scale.set(1, 1 + windIntensity * 1.0, 1.2 + windIntensity * 1.8);
          sDummy.updateMatrix();
          streakMesh.setMatrixAt(i, sDummy.matrix);
        }
        streakMesh.instanceMatrix.needsUpdate = true;
        streakMat.opacity = 0.05 + windIntensity * 0.35;
      }

      // Camera trails behind (larger z) and above the petal, looking ahead.
      // While steering (windIntensity up), pull the camera back so the POV
      // zooms out and the whole wind effect is in frame.
      const zoom = 1 + windIntensity * 1.6;
      const target = new THREE.Vector3(
        petalPos.x * 0.6 * zoom - camera.rotation.y * windIntensity,
        petalPos.y * 0.55 + 4.2 + windIntensity * 2.4,
        petalPos.z + 15 * zoom
      );
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30 - windIntensity * 10);

      // Proximity: petals near the camera fade toward translucent, graduating
      // smoothly across the band. The default POV puts ring petals ~15 units
      // from the camera and the trail streams 12–25 out, so the band is wide
      // (6–20) to actually be visible during play, not just on a head-on
      // dive into the lens.
      const FADE_NEAR = 7;
      const FADE_FAR = 22;
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
        m.material.uniforms.uOpacity.value = 0.1 + 0.9 * alpha; // nearly gone when right at the lens
      }
    },
  };

  function scaleBuds(buds) {
    budData = buds;
    budTimes = buds.map(() => null);
    budLocal = buds.map(() => 0);
    const perKind = KIND_GEOMETRIES.map(() => []);
    buds.forEach((b, i) => {
      const k = (b.kind ?? 0) % perKind.length;
      perKind[k].push(i);
    });
    for (const m of budMeshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    budMeshes = [];
    for (const m of stemMeshes) {
      scene.remove(m);
      m.geometry.dispose();
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