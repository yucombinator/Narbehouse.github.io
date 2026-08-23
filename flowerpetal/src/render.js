import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS } from './trail.js';
import { HILLS } from './hill.js';
import { windAt } from './wind.js';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

// A petal as a rounded teardrop: stretched blob, tapered toward the crown,
// used in two layers so blooms read as organic petals instead of blobby
// spheres. Higher segment counts for a smooth silhouette.
function teardropPetal(len, wide, thin = 0.3) {
  const g = new THREE.SphereGeometry(len, 14, 10);
  g.scale(wide, wide * 0.62, thin);
  g.rotateZ(0); // long axis along +x before being rotated per-petal
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
const STEM_MAT = new THREE.MeshStandardMaterial({ color: 0x3e8f3e, roughness: 0.8 });
const STEM_LEN = 2.2;
const CROWN_LIFT = STEM_LEN + 0.25; // crown height above the terrain

// Player petal: an elongated, tapered blade along Z (flight direction) — a
// wider rounded tip and narrower base, like a real flower petal rather than
// a plain pill.
const PETAL_GEO = new THREE.SphereGeometry(0.26, 14, 10);
PETAL_GEO.scale(0.3, 0.62, 1.6);
{
  const pos = PETAL_GEO.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / 1.6; // -1..1 along the blade
    // taper width toward the base (z = -1) and round the tip (z = +1)
    const taper = 0.45 + 0.55 * Math.pow(0.5 + z * 0.5, 0.7);
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, pos.getY(i) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, Math.max(0, (z + 1) / 2)))));
  }
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

  // --- World-fixed ground: ONE plane at world origin, displaced by HILLS at
  // true world coordinates. Flowers, grass, and the petal's clamp sample the
  // same function at the same origin, so nothing can float off the surface.
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
      const wx = gpos.getX(i);   // plane local x == world x
      const wz = gpos.getY(i);   // plane local y is world z after the rotation below
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

  // Grass rides the world terrain. The InstancedMesh stays in world space;
  // each blade is planted at HILLS(worldX, worldZ) and the whole field
  // re-centers on the player's (x, z) each frame (local seeds in ±GRASS_R).
  const GRASS_N = 900;
  const GRASS_R = 60;
  const grassGeo = new THREE.PlaneGeometry(0.12, 1.1, 1, 3);
  grassGeo.translate(0, 0.55, 0);
  const grassMat = new THREE.MeshBasicMaterial({ color: 0x6fbf4a, side: THREE.DoubleSide });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_N);
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const gDummy = new THREE.Object3D();
  const grassSeeds = [];
  for (let i = 0; i < GRASS_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * GRASS_R;
    grassSeeds.push({
      x: Math.cos(a) * r,
      z: Math.sin(a) * r,
      yaw: Math.random() * Math.PI * 2,
      s: 0.7 + Math.random() * 0.9,
      ph: Math.random() * Math.PI * 2,
      sway: 0.25 + Math.random() * 0.5,
    });
  }
  scene.add(grass);

  // --- Player: a swirling wreath of petals ("I am the wind, not the flower").
  // No center bloom, no heart — just loose petals circling a point.
  const petal = new THREE.Group();
  const petalRing = new THREE.Group();
  petal.add(petalRing);
  scene.add(petal);

  const petalMats = [];
  const petalMeshes = [];
  let petalColors = [0xff9ec0];
  let nowSec = 0; // game clock, cached from frame() for eases
  let petalGeometry = PETAL_GEO; // upgraded to the CC-BY model when loaded
  let windIntensity = 0; // 0 = calm, 1 = full wind rush (ramps with steering)
  const trailHistory = []; // {x,y,z} recent flight positions for the petal trail

  // Add ONE new petal (ease-in) without disturbing the existing swarm.
  // Existing petals keep their orbits/poses; only the next one appears small
  // at the centre and grows into place — no full-swarm reset on pickup.
  function spawnPetalMesh() {
    const color = petalColors[petalColors.length - 1] ?? 0xff9ec0;
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.28,
      roughness: 0.5,
      metalness: 0.08,
      vertexColors: true,
      side: THREE.DoubleSide,
    });
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
      born: nowSec, // eases in from the swarm centre
      baseYaw: (Math.random() - 0.5) * 2.6,
      basePitch: (Math.random() - 0.5) * 0.9,
      baseRoll: (Math.random() - 0.5) * 1.1,
    };
    m.scale.setScalar(0.2); // start small at the centre
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
      const mat = new THREE.MeshStandardMaterial({
        color: petalColors[i] ?? petalColors[petalColors.length - 1],
        emissive: petalColors[i] ?? petalColors[petalColors.length - 1],
        emissiveIntensity: 0.28,
        roughness: 0.5,
        metalness: 0.08,
        vertexColors: true, // use the baked light gradient for form
        side: THREE.DoubleSide,
      });
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
      new THREE.RingGeometry(0.5, 0.85, 28),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide })
    );
    ring.visible = false;
    scene.add(ring);
    ringPool.push(ring);
  }
  let ringCursor = 0;

  const motherMat = new THREE.MeshBasicMaterial({ color: 0xff9ecb, transparent: true, opacity: 0.95 });
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

  // Wind streak ring: instanced thin light blades that swirl around the
  // player, growing long and bright with the steering wind-rush.
  const STREAK_N = 26;
  const streakGeo = new THREE.PlaneGeometry(0.5, 0.5, 1, 1);
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const streakMesh = new THREE.InstancedMesh(streakGeo, streakMat, STREAK_N);
  streakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const streakSeeds = [];
  for (let i = 0; i < STREAK_N; i++) {
    streakSeeds.push({
      ang: (i / STREAK_N) * Math.PI * 2 + Math.random() * 0.4,
      spin: 0.4 + Math.random() * 0.5,
      r: 2.2 + Math.random() * 2.4,
      yoff: (Math.random() - 0.5) * 2.6,
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
        // At the cap: drop the oldest petal, keep the rest, add the newest.
        const oldest = petalMeshes.shift();
        petalRing.remove(oldest);
        oldest.material.dispose();
        petalMats.shift();
        petalColors.shift();
      }
      petalColors.push(hex);
      spawnPetalMesh(); // only the new petal animates — the swarm stays put
    },
    setPetalCount(n) {
      const cur = petalColors[petalColors.length - 1] ?? 0xff9ec6;
      petalColors = Array.from({ length: Math.max(1, Math.min(MAX_PETALS, n)) }, () => cur);
      rebuildPetals();
    },
    setPetalGlow(progress) {
      const intensity = 0.35 + progress * 0.6;
      for (const mat of petalMats) mat.emissiveIntensity = intensity;
    },
    // Swap in the loaded 3D petal (CC-BY cherry blossom). Applied to every
    // petal on the next rebuild; the procedural one is used until then.
    setPetalGeometry(geo) {
      petalGeometry = geo;
      for (const m of petalMeshes) m.geometry = geo;
    },
    frame(dt, petalPos, bank, timeSec, steerLevel = 0) {
      nowSec = timeSec; // keep the acquisition clock current
      petal.position.set(petalPos.x, petalPos.y, petalPos.z);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;
      // Wind intensity eases toward the steering input.
      	      windIntensity = Math.min(1, windIntensity + (steerLevel - windIntensity) * Math.min(1, dt * 1.1));
      // Trail: record the recent path; petals stream behind like a comet.
      trailHistory.unshift({ x: petalPos.x, y: petalPos.y, z: petalPos.z });
      if (trailHistory.length > MAX_PETALS + 2) trailHistory.pop();
      const wind = windAt(timeSec, 11);
      const windBias = Math.max(-1, Math.min(1, wind.swayVx));
      for (let i = 0; i < petalMeshes.length; i++) {
        const m = petalMeshes[i];
        const u = m.userData;
        // Ease-in for a freshly acquired petal.
        let ease = 1;
        if (u.born >= 0) {
          const age = timeSec - u.born;
          const k = Math.min(1, age / 1.0);
          ease = k * k * (3 - 2 * k);
        }
        // Slot: petals chase the path point `i+1` steps back, with per-petal
        // lateral drift so they trail in a loose ribbon, not a single line.
        u.orbit += dt * u.dir * u.speed * 0.3; // slow personal wander
        const slot = trailHistory[Math.min(i + 1, trailHistory.length - 1)] || petalPos;
        const lat = Math.sin(u.ph0 + timeSec * 0.6) * 0.7;
        const lat2 = Math.cos(u.ph0 * 2 + timeSec * 0.8) * 0.5;
        const px = slot.x + lat + windBias * 0.7;
        const py = slot.y + lat2 * 0.4;
        const pz = slot.z;
        m.position.set(
          lerp(m.position.x, px, ease),
          lerp(m.position.y, py, ease),
          lerp(m.position.z, pz, ease)
        );
        m.scale.setScalar((0.3 + ease * 0.7) * (1 + windIntensity * 0.18));
        // Orient along the trail direction with per-petal rest pose.
        m.rotation.x = u.basePitch + windBias * 0.18 + Math.sin(timeSec * 1.4 + u.ph0) * 0.06;
        m.rotation.y = u.baseYaw + Math.sin(timeSec * 1.1 + u.ph0 * 2) * 0.08;
        m.rotation.z = u.baseRoll + Math.sin(timeSec * 0.9 + u.ph0) * 0.1;
      }

      // Grass: field centered on the petal in world space; each blade is
      // planted at HILLS(world) and bends with wind + proximity.
      const swayBase = Math.sin(timeSec * 1.4) * 0.18;
      for (let i = 0; i < GRASS_N; i++) {
        const s = grassSeeds[i];
        const wx = petalPos.x + s.x;
        const wz = petalPos.z + s.z;
        const dist = Math.hypot(s.x, s.z);
        const prox = Math.max(0, 1 - dist / 18);
        const bend = prox * prox * (s.sway * (0.5 + 0.5 * Math.sin(timeSec * 2.2 + s.ph)));
        gDummy.position.set(wx, HILLS.height(wx, wz), wz);
        gDummy.rotation.y = Math.atan2(s.x, s.z);
        gDummy.rotation.z = (swayBase + bend) * -Math.sign(s.x || 0.001);
        gDummy.scale.set(1, s.s, 1);
        gDummy.updateMatrix();
        grass.setMatrixAt(i, gDummy.matrix);
      }
      grass.instanceMatrix.needsUpdate = true;

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

      // Mother bloom: ride the terrain + pulse.
      if (mother.visible) {
        const m = 1 + Math.sin(timeSec * 1.8) * 0.08;
        mother.scale.setScalar(m);
        mother.rotation.z += dt * 0.4;
        mother.position.set(
          mother.userData.wx - camera.position.x,
          HILLS.height(mother.userData.wx, mother.userData.wz) + 1.2,
          mother.userData.wz - camera.position.z
        );
      }

      // Sky + clouds track the camera.
      sky.position.copy(camera.position);
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 140) c.position.x = -140;
        c.position.z = camera.position.z + c.userData.zo;
      }

      // Wind streak particles: a ring of light streamers around the player
      // that brighten and stretch when steering (windIntensity).
      if (streakMat) {
        const sDummy = new THREE.Object3D();
        for (let i = 0; i < STREAK_N; i++) {
          const s = streakSeeds[i];
          const angle = s.ang + timeSec * s.spin;
          const rr = s.r * (1 + windIntensity * 0.5);
          sDummy.position.set(
            petalPos.x + Math.cos(angle) * rr,
            petalPos.y + Math.sin(angle) * rr * 0.4 + s.yoff,
            petalPos.z + Math.sin(angle * 1.3) * 2 * windIntensity
          );
          sDummy.scale.set(1, 1 + windIntensity * 2.2, 1 + windIntensity * 1.6);
          sDummy.updateMatrix();
          streakMesh.setMatrixAt(i, sDummy.matrix);
        }
        streakMesh.instanceMatrix.needsUpdate = true;
        streakMat.opacity = 0.12 + windIntensity * 0.5;
      }

      // Camera trails behind (larger z) and above the petal, looking ahead.
      // While steering (windIntensity up), pull the camera back so the POV
      // zooms out and the whole wind effect is in frame.
      	      const zoom = 1 + windIntensity * 1.6;
      const target = new THREE.Vector3(
        petalPos.x * 0.6 * zoom - camera.rotation.y * windIntensity,
        petalPos.y * 0.55 + 4.2 + windIntensity * 2.4,
        petalPos.z + 11 * zoom
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
      const mesh = new THREE.InstancedMesh(
        KIND_GEOMETRIES[k],
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        indices.length
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      indices.forEach((idx, local) => {
        budLocal[idx] = local;
        mesh.setColorAt(local, new THREE.Color(buds[idx].colorHex));
      });
      mesh.castShadow = true;
      scene.add(mesh);
      budMeshes[k] = mesh;

      // A stem beneath each crown of this kind.
      const stems = new THREE.InstancedMesh(STEM_GEO, STEM_MAT, indices.length);
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