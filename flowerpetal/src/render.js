import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS } from './trail.js?v=2';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

// A radially symmetric flower lying in the XY plane (faces the camera).
// `spread` scales how far petals sit from the center, giving each kind its
// own silhouette.
function buildFlowerGeometry({ petalRadius = 0.5, centerRadius = 0.26, petals = 5, spread = 1.0 } = {}) {
  const parts = [];
  const petalGeo = new THREE.SphereGeometry(petalRadius, 8, 6);
  petalGeo.scale(1, 1, 0.28); // flatten along z so it reads as a flat flower
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

// One merged geometry per flower kind: distinct petal counts and spreads.
const KIND_GEOMETRIES = FLOWER_KINDS.map((k) =>
  buildFlowerGeometry({ petalRadius: 0.5, centerRadius: k.bigCenter, petals: k.petals, spread: k.spread })
);

// Mother bloom: a fuller, larger flower at the trail's end.
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.15, centerRadius: 0.5, petals: 8, spread: 1.25 });

// A single player petal: a flattened ellipsoid elongated along z, so it can be
// rotated and placed radially. The player starts with ONE of these and
// accumulates more (up to MAX_PETALS) as flowers are collected.
const PETAL_GEO = new THREE.SphereGeometry(0.34, 8, 6);
PETAL_GEO.scale(1.6, 0.75, 0.3);
const PETAL_HEART_GEO = new THREE.SphereGeometry(0.15, 8, 6);
export const MAX_PETALS = 8;
const PETAL_RING_R = 0.3; // base radius the petal bases sit on

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 90, 320);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, 40);

  // Sky dome: large sphere, BackSide, gradient via vertex colors.
  const skyGeo = new THREE.SphereGeometry(500, 24, 12);
  const pos = skyGeo.attributes.position;
  const colors = [];
  const top = new THREE.Color(SKY_TOP);
  const bottom = new THREE.Color(SKY_BOTTOM);
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 500, 0, 1);
    colors.push(
      top.r * t + bottom.r * (1 - t),
      top.g * t + bottom.g * (1 - t),
      top.b * t + bottom.b * (1 - t)
    );
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true }));
  scene.add(sky);

  // Rolling green hills (Bliss-style): a big plane whose vertices are raised
  // by layered sine ridges and tinted with a green gradient so it reads as
  // countryside, not a flat disc.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900, 96, 96),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })
  );
  {
    const gpos = ground.geometry.attributes.position;
    const hillA = 3.2 + Math.random() * 2.0;
    const hillB = 1.8 + Math.random() * 1.4;
    const hillColors = [];
    const cHigh = new THREE.Color(0x7ec850);
    const cLow = new THREE.Color(0x9ee06a);
    for (let i = 0; i < gpos.count; i++) {
      const x = gpos.getX(i);
      const y = gpos.getY(i); // plane local y = world z after rotation
      // Layered rolling bumps.
      const h =
        hillA * Math.sin(x * 0.012 + 0.6) * Math.sin(y * 0.02 + 1.1) +
        hillB * Math.sin(x * 0.03 + 2.2) * Math.sin(y * 0.037 + 0.3);
      gpos.setZ(i, h);
      // Slightly green-tinted by height: valleys darker, peaks brighter.
      const t = THREE.MathUtils.clamp((h + 5) / 10, 0, 1);
      const c = cLow.clone().lerp(cHigh, t);
      hillColors.push(c.r, c.g, c.b);
    }
    ground.geometry.setAttribute('color', new THREE.Float32BufferAttribute(hillColors, 3));
    ground.geometry.computeVertexNormals();
    ground.geometry.attributes.position.needsUpdate = true;
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -6;
    scene.add(ground);
  }

  // Grass field: instanced blades whose tops bend as the player flies near.
  // CPU-driven sway (no shaders): each blade's tip leans by an amount that
  // falls off with distance from the petal and breathes with time.
  const GRASS_N = 900;
  const GRASS_R = 46; // band of grass around the player
  const grassGeo = new THREE.PlaneGeometry(0.12, 1.1, 1, 3);
  grassGeo.translate(0, 0.55, 0); // pivot at the base
  const grassMat = new THREE.MeshBasicMaterial({
    color: 0x6fbf4a,
    side: THREE.DoubleSide,
  });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_N);
  grass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const gDummy = new THREE.Object3D();
  const grassSeeds = [];
  // Pre-scatter blades in a disc around origin; the whole field follows the
  // camera each frame so the player is always surrounded by grass.
  for (let i = 0; i < GRASS_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * GRASS_R;
    const gw = Math.random() * Math.PI * 2;
    grassSeeds.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, s: 0.7 + Math.random() * 0.9, ph: Math.random() * Math.PI * 2, sway: 0.25 + Math.random() * 0.5 });
    gDummy.position.set(grassSeeds[i].x, 0.0, grassSeeds[i].z);
    gDummy.scale.set(1, grassSeeds[i].s, 1);
    gDummy.rotation.y = gw;
    gDummy.updateMatrix();
    grass.setMatrixAt(i, gDummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  scene.add(grass);

  // --- Player: a ring of petals that grows as flowers are collected -----
  // `petal` is the world group (position, bank roll, size). `petalRing`
  // carries the individual petal meshes and slowly swirls.
  const petal = new THREE.Group();
  const petalRing = new THREE.Group();
  petal.add(petalRing);
  scene.add(petal);

  const petalMats = [];
  const petalMeshes = [];
  let petalColors = [0xff9ec0]; // start as a single pink petal

  function rebuildPetals() {
    // Tear down the old ring.
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
        emissiveIntensity: 0.4,
        roughness: 0.4,
      });
      const m = new THREE.Mesh(PETAL_GEO, mat);
      // Spread evenly around the circle; slight radius/rotation jitter keeps
      // it organic as new petals join.
      const angle = (i / count) * Math.PI * 2;
      const r = PETAL_RING_R * (0.85 + Math.random() * 0.35);
      m.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      m.rotation.z = angle + (Math.random() - 0.5) * 0.35; // point outward
      petalRing.add(m);
      petalMeshes.push(m);
      petalMats.push(mat);
    }
    // Small heart in the center.
    if (!petalRing.userData.heart) {
      petalRing.userData.heart = new THREE.Mesh(
        PETAL_HEART_GEO,
        new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb44d, emissiveIntensity: 0.5 })
      );
      petalRing.add(petalRing.userData.heart);
    }
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 60, 20);
  scene.add(ambient, sun);

  // --- Buds (instanced flowers) -----------------------------------------
  let budMeshes = []; // one InstancedMesh per flower kind
  let budData = []; // {x,y,z,colorHex,kind}
  let budTimes = []; // seconds since collected (null = active)
  let budLocalIndex = []; // global bud index -> index inside its kind mesh
  const pops = []; // {x,y,z,life,ring} collection bursts
  // Ring pool for collection pops (fixed small pool, no per-collect allocation).
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

  // Mother bloom: larger pulsing flower at the trail's end.
  const motherMat = new THREE.MeshBasicMaterial({ color: 0xff9ecb, transparent: true, opacity: 0.95 });
  const mother = new THREE.Mesh(MOTHER_FLOWER, motherMat);
  mother.visible = false;
  scene.add(mother);

  // Drifting cloud puffs (cheap billboard-ish spheres).
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 12, 10, 8), cloudMat);
    c.position.set((Math.random() - 0.5) * 220, 24 + Math.random() * 26, (Math.random() - 0.5) * 180);
    c.scale.y = 0.35;
    c.userData.speed = 0.4 + Math.random() * 0.7;
    c.userData.zo = (Math.random() - 0.5) * 160;
    c.position.z = c.userData.zo;
    scene.add(c);
    clouds.push(c);
  }

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
        mother.position.set(motherPos.x, motherPos.y, motherPos.z);
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
    // Add a petal of the collected flower's color (organic ring re-spread).
    addPetal(hex) {
      petalColors.push(hex);
      if (petalColors.length > MAX_PETALS) petalColors.shift();
      rebuildPetals();
    },
    // Restore a petal count on load (fills with the current tint).
    setPetalCount(n) {
      const cur = petalColors[petalColors.length - 1] ?? 0xff9ec6;
      petalColors = Array.from({ length: Math.max(1, Math.min(MAX_PETALS, n)) }, () => cur);
      rebuildPetals();
    },
    // Growth glow: raise emissive a touch as size nears the cap.
    setPetalGlow(progress) {
      const intensity = 0.35 + progress * 0.6;
      for (const mat of petalMats) mat.emissiveIntensity = intensity;
    },
    frame(dt, petalPos, bank, timeSec) {
      petal.position.set(petalPos.x, petalPos.y, petalPos.z);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;
      // Organic swirl: the whole petal ring slowly circles.
      petalRing.rotation.z = timeSec * 0.5;

      // Active buds gently pulse; collected ones shrink away and are then
      // moved far below the world so they are truly gone from the scene.
      // Each kind has its own InstancedMesh; per-instance updates write into
      // the correct mesh via the per-kind index map.
      if (budMeshes.length) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < budData.length; i++) {
          const b = budData[i];
          if (!b) continue;
          const m = budMeshes[b.kindIndex];
          if (!m) continue;
          const local = budLocalIndex[i];
          let scale = 1;
          if (budTimes[i] !== null) {
            budTimes[i] += dt;
            if (budTimes[i] > 0.25) {
              dummy.position.set(b.x, -500, b.z);
              dummy.scale.setScalar(0.001);
            } else {
              scale = 1 - budTimes[i] / 0.25;
              dummy.position.set(b.x, b.y, b.z);
              dummy.scale.setScalar(scale);
            }
          } else {
            scale = 1 + Math.sin(timeSec * 2.5 + i) * 0.06;
            dummy.position.set(b.x, b.y, b.z);
            dummy.scale.setScalar(scale);
          }
          dummy.updateMatrix();
          m.setMatrixAt(local, dummy.matrix);
        }
        for (const m of budMeshes) m.instanceMatrix.needsUpdate = true;
      }

      // Pops: expand and fade each pop's own ring.
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

      // Mother bloom gentle pulse.
      if (mother.visible) {
        const m = 1 + Math.sin(timeSec * 1.8) * 0.08;
        mother.scale.setScalar(m);
        mother.rotation.z += dt * 0.4;
      }

      // Sky dome, ground, and clouds travel with the camera so the world
      // visibly scrolls forward as the petal flies down the path.
      sky.position.copy(camera.position);
      ground.position.set(0, -6, camera.position.z);
      // Grass follows the player; blades near the petal bend harder.
      const swayBase = Math.sin(timeSec * 1.4) * 0.18;
      for (let i = 0; i < GRASS_N; i++) {
        const seed = grassSeeds[i];
        const dx = seed.x + camera.position.x - petalPos.x;
        const dz = seed.z + camera.position.z - petalPos.z;
        const dist = Math.hypot(dx, dz);
        // Falloff: strongly agitated within ~6 units, calm beyond 18.
        const proximity = Math.max(0, 1 - dist / 18);
        const bend = proximity * proximity * (seed.sway * (0.5 + 0.5 * Math.sin(timeSec * 2.2 + seed.ph)));
        gDummy.position.set(seed.x + camera.position.x, 0, seed.z + camera.position.z);
        gDummy.rotation.y = Math.atan2(dx, dz);
        gDummy.rotation.z = (swayBase + bend) * -Math.sign(dx || 0.001);
        gDummy.scale.set(1, seed.s, 1);
        gDummy.updateMatrix();
        grass.setMatrixAt(i, gDummy.matrix);
      }
      grass.instanceMatrix.needsUpdate = true;

      // Camera trails behind (larger z) and above the petal, looking ahead (-z).
      const target = new THREE.Vector3(petalPos.x * 0.6, petalPos.y * 0.55 + 4.2, petalPos.z + 11);
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30);
    },
  };

  function scaleBuds(buds) {
    budData = buds;
    budTimes = buds.map(() => null);
    budLocalIndex = buds.map((b) => b.kindIndex ?? 0);
    // Tear down old kind meshes.
    for (const m of budMeshes) {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    budMeshes = [];
    // One InstancedMesh per flower kind.
    const perKind = KIND_GEOMETRIES.map(() => []);
    buds.forEach((b, i) => {
      const kind = b.kind ?? 0;
      perKind[kind % KIND_GEOMETRIES.length].push(i);
    });
    const kindScale = [1.0, 1.05, 0.92, 1.1];
    perKind.forEach((indices, kind) => {
      if (!indices.length) return;
      const mesh = new THREE.InstancedMesh(
        KIND_GEOMETRIES[kind],
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        indices.length
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const dummy = new THREE.Object3D();
      indices.forEach((budIndex, local) => {
        budLocalIndex[budIndex] = local;
        const b = buds[budIndex];
        dummy.position.set(b.x, b.y, b.z);
        dummy.scale.setScalar(kindScale[kind % kindScale.length]);
        dummy.updateMatrix();
        mesh.setMatrixAt(local, dummy.matrix);
        mesh.setColorAt(local, new THREE.Color(b.colorHex));
      });
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh);
      budMeshes[kind] = mesh;
    });
  }

  rebuildPetals();
  api.setPetalSize(1);
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