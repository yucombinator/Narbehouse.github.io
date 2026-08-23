import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS } from './trail.js';
import { HILLS } from './hill.js';
import { windAt } from './wind.js';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

// Shared lighting — the same sun model the grass uses, applied to petals,
// flower crowns, and stems: warm directional key + subsurface backlight +
// sky fill + distance fog. Gives every surface the soft, sunlit look of the
// meadow.
const SHADED_UNIFORMS = () => ({
  uSunDir: { value: new THREE.Vector3(40, 70, 25).normalize() },
  uTint: { value: new THREE.Color(1, 1, 1) },
  skyAmount: { value: 0.35 },
  fogColor: { value: new THREE.Color(SKY_BOTTOM) },
  fogNear: { value: 90 },
  fogFar: { value: 320 },
});

const SHADED_VERT = `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vVertColor;
  #ifdef HAS_ICOLOR
    attribute vec3 iColor;
  #endif
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    #ifdef USE_COLOR
      vVertColor = color;
    #else
      #ifdef HAS_ICOLOR
        vVertColor = iColor;
      #else
        vVertColor = vec3(1.0);
      #endif
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SHADED_FRAG = `
  uniform vec3 uSunDir;
  uniform vec3 uTint;
  uniform float skyAmount;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vVertColor;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 sunDir = normalize(uSunDir);
    float nDotL = max(0.0, dot(n, sunDir));
    vec3 sunLight = vec3(1.0, 0.94, 0.76) * (nDotL * 0.85);
    // Subsurface backlight (warm glow through thin petals, like the grass).
    float sss = pow(max(0.0, dot(-n, sunDir)), 2.0) * 0.55;
    sunLight += vec3(1.0, 0.92, 0.72) * sss;
    // Cool sky fill, stronger on upward faces.
    vec3 skyLight = vec3(0.75, 0.88, 1.0) * (skyAmount + 0.35 * max(0.0, n.y));
    vec3 col = vVertColor * uTint * (skyLight + sunLight);
    // Distance fog (matches scene fog).
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float fogFactor = clamp((depth - fogNear) / (fogFar - fogNear), 0.0, 1.0);
    col = mix(col, fogColor, pow(fogFactor, 1.2));
    gl_FragColor = vec4(col, 1.0);
  }
`;

function makeShadedMaterial(color, vertexColors = false) {
  return new THREE.ShaderMaterial({
    uniforms: SHADED_UNIFORMS(),
    vertexShader: SHADED_VERT,
    fragmentShader: SHADED_FRAG,
    vertexColors: !!vertexColors,
    side: THREE.DoubleSide,
  });
}

function buildFlowerGeometry({ petalRadius = 0.5, centerRadius = 0.26, petals = 5, spread = 1.0 } = {}) {
  const parts = [];
  const petalGeo = new THREE.SphereGeometry(petalRadius, 8, 6);
  petalGeo.scale(1, 1, 0.28);
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const g = petalGeo.clone();
    g.rotateZ(a);
    g.translate(Math.cos(a) * petalRadius * 1.15 * spread, Math.sin(a) * petalRadius * 1.15 * spread, 0);
    parts.push(g);
  }
  parts.push(new THREE.SphereGeometry(centerRadius, 10, 8));
  return mergeGeometries(parts);
}

// A petal as a rounded teardrop: stretched blob, tapered toward the crown,
// used in two layers so blooms read as organic petals instead of blobby
// spheres. Higher segment counts for a smooth silhouette.
function teardropPetal(len, wide, thin = 0.3) {
  const g = new THREE.SphereGeometry(len, 14, 10);
  g.scale(wide, wide * 0.62, thin);
  g.rotateZ(0); // long axis along +x before being rotated per-petal
  return g;
}

function buildFlowerGeometryRealistic({ petalRadius = 0.5, centerRadius = 0.26, petals = 5, spread = 1.0 } = {}) {
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
        layer === 0 ? 0 : -0.12
      );
      parts.push(g);
    }
  }
  const heart = new THREE.SphereGeometry(centerRadius, 12, 9);
  heart.scale(1, 1, 0.9);
  parts.push(heart);
  return mergeGeometries(parts);
}

const KIND_GEOMETRIES = FLOWER_KINDS.map((k) =>
  buildFlowerGeometry({ petalRadius: 0.5, centerRadius: k.bigCenter, petals: k.petals, spread: k.spread })
);
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.15, centerRadius: 0.5, petals: 8, spread: 1.25 });

// Player petal: an elongated, tapered blade along Z (flight direction) — a
// wider rounded tip and narrower base, like a real flower petal rather than
// a plain pill.
const PETAL_GEO = new THREE.SphereGeometry(0.2, 14, 10);
PETAL_GEO.scale(0.3, 0.62, 1.6);
{
  const pos = PETAL_GEO.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 1.6;
    const taper = 0.45 + 0.55 * Math.pow(0.5 + z * 0.5, 0.7);
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, pos.getY(i) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, Math.max(0, (z + 1) / 2)))));
  }
  PETAL_GEO.computeVertexNormals();
}
export const MAX_PETALS = 8;
const PETAL_RING_R = 0.3;

// A slender stem for the collectible flowers: tapered green cylinder rising
// from the ground to the flower crown. Bases at y=0 (lives in world space).
const STEM_GEO = new THREE.CylinderGeometry(0.03, 0.05, 1, 6);
STEM_GEO.translate(0, 0.5, 0);
const STEM_LEN = 2.2;
const CROWN_LIFT = STEM_LEN + 0.25;

const KIND_SCALE = [1.0, 1.05, 0.92, 1.1];

// Linear interpolation helper (the frame eases petals toward their slot).
function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 90, 320);
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

  // Big enough to cover the whole flight path with grass always on it. The
  // fog hides the far edge; the terrain stays world-fixed so flowers, grass
  // and the petal's floor-clamp all sample the same HILLS at the same origin.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 160, 160),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })
  );
  {
    const gpos = ground.geometry.attributes.position;
    const hillColors = [];
    const cHigh = new THREE.Color(0x7ec850);
    const cLow = new THREE.Color(0x9ee06a);
    for (let i = 0; i < gpos.count; i++) {
      const wx = gpos.getX(i);
      const wz = gpos.getY(i);
      const h = HILLS.height(wx, wz);
      gpos.setZ(i, h);
      const t = THREE.MathUtils.clamp((h + 5) / 10, 0, 1);
      const c = cLow.clone().lerp(cHigh, t);
      hillColors.push(c.r, c.g, c.b);
    }
    ground.geometry.setAttribute('color', new THREE.Float32BufferAttribute(hillColors, 3));
    ground.geometry.computeVertexNormals();
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, 0);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  // Grass rides the world terrain (the new grass module handles its own scene
  // wiring; here we only keep a reference hook for the old API).
  const GRASS_N = 0; // legacy grass disabled — grass.js owns the field now

  // --- Player ring ---
  const petal = new THREE.Group();
  const petalRing = new THREE.Group();
  petal.add(petalRing);
  scene.add(petal);

  const petalMats = [];
  const petalMeshes = [];
  let petalColors = [0xff9ec0];
  let nowSec = 0;
  let petalGeometry = PETAL_GEO;
  let windIntensity = 0;
  const trailHistory = [];

  // Add ONE new petal (ease-in) without disturbing the existing swarm.
  function spawnPetalMesh() {
    const color = petalColors[petalColors.length - 1] ?? 0xff9ec1;
    const mat = makeShadedMaterial(color, true);
    const m = new THREE.Mesh(petalGeometry, mat);
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
      born: nowSec,
      baseYaw: (Math.random() - 0.5) * 2.6,
      basePitch: (Math.random() - 0.5) * 0.9,
      baseRoll: (Math.random() - 0.5) * 1.1,
    };
    m.scale.setScalar(0.2);
    m.position.set(0, 0, 0);
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
      const mat = makeShadedMaterial(petalColors[i] ?? petalColors[petalColors.length - 1], true);
      const m = new THREE.Mesh(petalGeometry, mat);
      const isNew = i === count - 1 && count > 1;
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
        born: isNew ? nowSec : -10,
        baseYaw: (Math.random() - 0.5) * 2.6,
        basePitch: (Math.random() - 0.5) * 0.9,
        baseRoll: (Math.random() - 0.5) * 1.1,
      };
      m.scale.setScalar(isNew ? 0.2 : 1);
      m.position.set(0, 0, 0);
      petalRing.add(m);
      petalMeshes.push(m);
      petalMats.push(mat);
    }
  }

  // Global lights: still drive the standard-material ground/sky with the same
  // sun; the shaded petals/flowers read their own uniforms.
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
  ground.receiveShadow = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  petal.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  // --- Buds (one InstancedMesh per kind, world-space) ---
  let budMeshes = [];
  let stemMeshes = [];
  let budData = [];
  let budTimes = [];
  let budLocal = [];
  let budRowYRamp = [];
  const pops = [];
  const ringPool = [];
  for (let i = 0; i < 10; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.85, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.visible = false;
    scene.add(ring);
    ringPool.push(ring);
  }
  let ringCursor = 0;

  const motherMat = makeShadedMaterial(0xff9ecb, false);
  const mother = new THREE.Mesh(MOTHER_FLOWER, motherMat);
  mother.visible = false;
  mother.userData.wx = 0;
  mother.userData.wz = 0;
  mother.castShadow = true;
  scene.add(mother);

  // Clouds.
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 12, 10, 8), cloudMat);
    c.scale.y = 0.35;
    c.userData.speed = 0.4 + Math.random() * 0.7;
    c.userData.zo = (Math.random() - 0.5) * 160;
    c.position.set((Math.random() - 0.5) * 220, 24 + Math.random() * 26, c.userData.zo);
    scene.add(c);
    clouds.push(c);
  }

  // Wind streaks: a handful of very thin, faint light lines.
  const STREAK_N = 10;
  const streakGeo = new THREE.PlaneGeometry(0.09, 0.9, 1, 1);
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
      progress: Math.random(),
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
      ring.material.opacity = 0.9;
      pops.push({ x: b.x, y: b.y, z: b.z, life: 0, ring });
      budTimes[index] = 0;
    },
    setPetalSize(s) {
      petal.scale.setScalar(s);
    },
    addPetal(hex) {
      if (petalColors.length >= MAX_PETALS) {
        const oldest = petalMeshes.shift();
        petalRing.remove(oldest);
        oldest.material.dispose();
        petalMats.shift();
        petalColors.shift();
      }
      petalColors.push(hex);
      spawnPetalMesh();
    },
    setPetalCount(n) {
      const cur = petalColors[petalColors.length - 1] ?? 0xff9ec6;
      petalColors = Array.from({ length: Math.max(1, Math.min(MAX_PETALS, n)) }, () => cur);
      rebuildPetals();
    },
    setPetalGlow(progress) {
      for (const mat of petalMats) {
        if (mat.uniforms && mat.uniforms.skyAmount) {
          mat.uniforms.skyAmount.value = 0.35 + progress * 0.6;
        }
      }
    },
    setPetalGeometry(geo) {
      petalGeometry = geo;
      for (const m of petalMeshes) m.geometry = geo;
    },
    resetTrail() {
      trailHistory.length = 0;
    },
    frame(dt, petalPos, bank, timeSec, steerLevel = 0) {
      nowSec = timeSec;
      petal.position.set(petalPos.x, petalPos.y, petalPos.z);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;
      windIntensity = Math.min(1, windIntensity + (steerLevel - windIntensity) * Math.min(1, dt * 1.1));
      // Trail history (unused by current petal layout but kept for API compat).
      {
        const last = trailHistory[0];
        if (!last || Math.hypot(last.x - petalPos.x, last.z - petalPos.z) > 3.2) {
          trailHistory.unshift({ x: petalPos.x, y: petalPos.y, z: petalPos.z });
          if (trailHistory.length > 40) trailHistory.pop();
        }
      }
      const wind = windAt(timeSec, 11);
      const windBias = Math.max(-1, Math.min(1, wind.swayVx));
      const RING_PETALS = 3;
      for (let i = 0; i < petalMeshes.length; i++) {
        const m = petalMeshes[i];
        const u = m.userData;
        let ease = 1;
        if (u.born >= 0) {
          const age = timeSec - u.born;
          ease = Math.max(0, Math.min(1, age / 1.0));
        }
        let px, py, pz;
        if (i < RING_PETALS) {
          const a = u.orbit + timeSec * (0.5 + windIntensity * 0.4);
          const rad = u.radius0 * (1 + 0.1 * Math.sin(timeSec * u.breathe + u.ph0));
          px = Math.cos(a) * rad;
          py = Math.sin(a) * rad * u.flat + 0.18 * Math.sin(timeSec * u.tumble + u.ph0);
          pz = u.z0 + Math.sin(timeSec * 1.1 + a * 2) * u.zdepth * 0.35;
        } else {
          const tIdx = i - RING_PETALS;
          const lg = 2.4 + tIdx * 2.6;
          const spiral = 0.5 + tIdx * 0.1;
          px = Math.cos(u.orbit + timeSec * 0.8) * spiral + windBias * 0.8;
          py = Math.sin(u.orbit * 1.7 + timeSec * 0.7) * 0.3 + Math.cos(u.ph0 + timeSec * 0.5) * 0.3;
          pz = lg;
        }
        const sx = lerp(m.position.x, px, Math.min(1, dt * 4) * ease);
        const sy = lerp(m.position.y, py, Math.min(1, dt * 4) * ease);
        const sz = lerp(m.position.z, pz, Math.min(1, dt * 4) * ease);
        const finalY = Math.max(HILLS.height(petalPos.x + sx, petalPos.z + sz) + 0.45, sy);
        m.position.set(sx, finalY, sz);
        m.scale.setScalar((0.5 + ease * 0.5) * (1 + windIntensity * 0.18));
        m.rotation.x = u.basePitch + windBias * 0.18 + Math.sin(timeSec * 1.4 + u.ph0) * 0.06;
        m.rotation.y = u.baseYaw + Math.sin(timeSec * 1.1 + u.ph0 * 2) * 0.08;
        m.rotation.z = u.baseRoll + Math.sin(timeSec * 0.9 + u.ph0) * 0.1;
        u.worldX = petalPos.x + sx;
        u.worldY = finalY;
        u.worldZ = petalPos.z + sz;
        m.material.transparent = true;
      }

      // Petals (flowers that were collected) removed from trail — the
      // per-petal fade remains for the near-camera band.
      const FADE_NEAR = 7;
      const FADE_FAR = 22;
      for (let i = 0; i < petalMeshes.length; i++) {
        const m = petalMeshes[i];
        const u = m.userData;
        if (u.worldX === undefined) continue;
        const camDist = Math.hypot(camera.position.x - u.worldX, camera.position.y - u.worldY, camera.position.z - u.worldZ);
        const alpha = Math.min(1, Math.max(0, (camDist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
        m.material.opacity = 0.1 + 0.9 * alpha;
      }

      // Earth-bound: grass handled by grass.js module (its own mesh).

      // Flowers: planted on the terrain in true world coords.
      if (budMeshes.length) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < budData.length; i++) {
          const b = budData[i];
          if (!b) continue;
          const kind = (b.kind ?? 0) % KIND_GEOMETRIES.length;
          const mesh = budMeshes[kind];
          const stemMesh = stemMeshes[kind];
          if (!mesh) continue;
          const local = budLocal[i];
          const groundY = HILLS.height(b.x, b.z);
          const crownY = groundY + CROWN_LIFT;
          if (budTimes[i] !== null) {
            budTimes[i] += dt;
            const kt = Math.min(1, budTimes[i] / 0.25);
            if (budTimes[i] > 0.25) {
              dummy.position.set(b.x, -500, b.z);
              dummy.scale.setScalar(0.001);
              if (stemMesh) {
                const sd = new THREE.Object3D();
                sd.position.set(b.x, groundY, b.z);
                sd.scale.set(1, 0.001, 1);
                sd.updateMatrix();
                stemMesh.setMatrixAt(local, sd.matrix);
              }
            } else {
              dummy.position.set(b.x, crownY, b.z);
              dummy.scale.setScalar((1 - kt) * KIND_SCALE[kind]);
              if (stemMesh) {
                const sd = new THREE.Object3D();
                sd.position.set(b.x, groundY, b.z);
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
              sd.position.set(b.x, groundY, b.z);
              sd.rotation.z = Math.sin(timeSec * 1.6 + i) * 0.04;
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

      // Pops.
      for (let i = pops.length - 1; i >= 0; i--) {
        const pop = pops[i];
        pop.life += dt;
        const k = Math.min(1, pop.life / 0.5);
        pop.ring.scale.setScalar(1 + k * 6);
        pop.ring.material.opacity = 0.9 * (1 - k);
        if (pop.life > 0.5) {
          pop.ring.visible = false;
          pops.splice(i, 1);
        }
      }

      // Mother bloom pulse.
      if (mother.visible) {
        const m = 1 + Math.sin(timeSec * 1.8) * 0.08;
        mother.scale.setScalar(m);
        mother.rotation.z += dt * 0.4;
        mother.position.set(
          mother.userData.wx,
          HILLS.height(mother.userData.wx, mother.userData.wz) + 2.6,
          mother.userData.wz
        );
      }

      // Sky + clouds track the camera.
      sky.position.copy(camera.position);
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 140) c.position.x = -140;
        c.position.z = camera.position.z + c.userData.zo;
      }

      // Wind streaks: linear flow along the travel direction, faster when
      // steering.
      const flowSpeed = 2.0 + windIntensity * 7;
      if (streakMat) {
        const dirX = camera.position.x - petalPos.x;
        const dirZ = camera.position.z - petalPos.z;
        const dirLen = Math.hypot(dirX, dirZ) || 1;
        const ex = dirX / dirLen;
        const ez = dirZ / dirLen;
        const sDummy = new THREE.Object3D();
        for (let i = 0; i < STREAK_N; i++) {
          const s = streakSeeds[i];
          s.progress = (s.progress + (flowSpeed * dt) / (s.r * 1.2 + 1.5)) % 1;
          const latX = Math.cos(s.ang + timeSec * s.spin) * (0.7 + s.r * 0.3);
          const latY = Math.sin(s.ang * 1.7 + timeSec * s.spin * 0.8) * 0.5 + s.yoff;
          const pxw = petalPos.x + ex * s.progress * dirLen * 0.8 + latX;
          const pzw = petalPos.z + ez * s.progress * dirLen * 0.8 + Math.sin(s.ang * 2 + timeSec * 0.7) * 0.4;
          sDummy.position.set(pxw, petalPos.y + latY, pzw);
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

      // Camera.
      const zoom = 1 + windIntensity * 1.6;
      const target = new THREE.Vector3(
        petalPos.x * 0.6 * zoom - camera.rotation.y * windIntensity,
        petalPos.y * 0.55 + 4.2 + windIntensity * 2.4,
        petalPos.z + 15 * zoom
      );
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30 - windIntensity * 10);
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
      m.material.dispose();
    }
    budMeshes = [];
    for (const m of stemMeshes) {
      scene.remove(m);
      m.geometry.dispose();
    }
    stemMeshes = [];
    perKind.forEach((indices, k) => {
      if (!indices.length) return;
      // Instance-tinted flower crowns via the sun-lit shader; three injects
      // instanceColor into ShaderMaterial? No — we bake iColor per instance.
      const mesh = new THREE.InstancedMesh(KIND_GEOMETRIES[k], makeShadedMaterial(0xffffff, false), indices.length);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const colors = new Float32Array(indices.length * 3);
      indices.forEach((idx, local) => {
        budLocal[idx] = local;
        const c = new THREE.Color(buds[idx].colorHex);
        colors[local * 3] = c.r;
        colors[local * 3 + 1] = c.g;
        colors[local * 3 + 2] = c.b;
      });
      mesh.geometry.setAttribute('iColor', new THREE.InstancedBufferAttribute(colors, 3));
      mesh.material.defines = { HAS_ICOLOR: '' };
      mesh.material.needsUpdate = true;
      mesh.castShadow = true;
      scene.add(mesh);
      budMeshes[k] = mesh;

      const stems = new THREE.InstancedMesh(STEM_GEO, makeShadedMaterial(0x3e8f3e, false), indices.length);
      const sd = new THREE.Object3D();
      indices.forEach((idx, local) => {
        const b = buds[idx];
        sd.position.set(b.x, HILLS.height(b.x, b.z), b.z);
        sd.scale.set(1, STEM_LEN, 1);
        sd.updateMatrix();
        stems.setMatrixAt(local, sd.matrix);
      });
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