import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FLOWER_KINDS } from './trail.js';
import { HILLS } from './hill.js';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

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

const KIND_GEOMETRIES = FLOWER_KINDS.map((k) =>
  buildFlowerGeometry({ petalRadius: 0.5, centerRadius: k.bigCenter, petals: k.petals, spread: k.spread })
);
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.15, centerRadius: 0.5, petals: 8, spread: 1.25 });

const PETAL_GEO = new THREE.SphereGeometry(0.34, 8, 6);
PETAL_GEO.scale(1.6, 0.75, 0.3);
const PETAL_HEART_GEO = new THREE.SphereGeometry(0.15, 8, 6);
export const MAX_PETALS = 8;
const PETAL_RING_R = 0.3;

const KIND_SCALE = [1.0, 1.05, 0.92, 1.1];

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

  // --- World group: terrain + grass + flowers in one moving frame --------
  const world = new THREE.Group();
  scene.add(world);

  // Rolling green hills.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600, 80, 80),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true })
  );
  {
    const gpos = ground.geometry.attributes.position;
    const hillColors = [];
    const cHigh = new THREE.Color(0x7ec850);
    const cLow = new THREE.Color(0x9ee06a);
    for (let i = 0; i < gpos.count; i++) {
      const lx = gpos.getX(i);
      const lz = gpos.getY(i);
      const h = HILLS.height(lx, lz);
      gpos.setZ(i, h);
      const t = THREE.MathUtils.clamp((h + 5) / 10, 0, 1);
      const c = cLow.clone().lerp(cHigh, t);
      hillColors.push(c.r, c.g, c.b);
    }
    ground.geometry.setAttribute('color', new THREE.Float32BufferAttribute(hillColors, 3));
    ground.geometry.computeVertexNormals();
    ground.rotation.x = -Math.PI / 2;
    world.add(ground);
  }

  // Grass.
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
  world.add(grass);

  // --- Player ring ---
  const petal = new THREE.Group();
  const petalRing = new THREE.Group();
  petal.add(petalRing);
  scene.add(petal);

  const petalMats = [];
  const petalMeshes = [];
  let petalColors = [0xff9ec0];

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
        emissiveIntensity: 0.4,
        roughness: 0.4,
      });
      const m = new THREE.Mesh(PETAL_GEO, mat);
      const angle = (i / count) * Math.PI * 2;
      const r = PETAL_RING_R * (0.85 + Math.random() * 0.35);
      m.position.set(Math.cos(angle) * r, Math.sin(angle) * r, 0);
      m.rotation.z = angle + (Math.random() - 0.5) * 0.35;
      petalRing.add(m);
      petalMeshes.push(m);
      petalMats.push(mat);
    }
    if (!petalRing.userData.heart) {
      const heart = new THREE.Mesh(
        PETAL_HEART_GEO,
        new THREE.MeshStandardMaterial({ color: 0xffd98a, emissive: 0xffb44d, emissiveIntensity: 0.5 })
      );
      petalRing.add(heart);
      petalRing.userData.heart = heart;
    }
  }

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 60, 20);
  scene.add(ambient, sun);

  // --- Buds (one InstancedMesh per kind, child of world) ---
  let budMeshes = [];
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
  world.add(mother);

  // Clouds.
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(9 + Math.random() * 12, 10, 8), cloudMat);
    c.scale.y = 0.35;
    c.userData.speed = 0.4 + Math.random() * 0.7;
    c.userData.zo = (Math.random() - 0.5) * 160;
    c.position.set((Math.random() - 0.5) * 220, 24 + Math.random() * 26, c.userData.zo);
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
      petalColors.push(hex);
      if (petalColors.length > MAX_PETALS) petalColors.shift();
      rebuildPetals();
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
    frame(dt, petalPos, bank, timeSec) {
      petal.position.set(petalPos.x, petalPos.y, petalPos.z);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;
      petalRing.rotation.z = timeSec * 0.5;

      // World streams past: group sits at the camera's foot (x, z).
      world.position.set(camera.position.x, 0, camera.position.z);

      // Grass: ride the terrain, bend with wind + proximity to the petal.
      const playerLocalX = petalPos.x - camera.position.x;
      const playerLocalZ = petalPos.z - camera.position.z;
      const swayBase = Math.sin(timeSec * 1.4) * 0.18;
      for (let i = 0; i < GRASS_N; i++) {
        const s = grassSeeds[i];
        const dcx = s.x - playerLocalX;
        const dcz = s.z - playerLocalZ;
        const dist = Math.hypot(dcx, dcz);
        const prox = Math.max(0, 1 - dist / 18);
        const bend = prox * prox * (s.sway * (0.5 + 0.5 * Math.sin(timeSec * 2.2 + s.ph)));
        gDummy.position.set(s.x, HILLS.height(s.x, s.z), s.z);
        gDummy.rotation.y = Math.atan2(dcx, dcz);
        gDummy.rotation.z = (swayBase + bend) * -Math.sign(dcx || 0.001);
        gDummy.scale.set(1, s.s, 1);
        gDummy.updateMatrix();
        grass.setMatrixAt(i, gDummy.matrix);
      }
      grass.instanceMatrix.needsUpdate = true;

      // Flowers: world positions -> local in the streaming world; y = terrain.
      if (budMeshes.length) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < budData.length; i++) {
          const b = budData[i];
          if (!b) continue;
          const kind = (b.kind ?? 0) % KIND_GEOMETRIES.length;
          const mesh = budMeshes[kind];
          if (!mesh) continue;
          const local = budLocal[i];
          const lx = b.x - camera.position.x;
          const lz = b.z - camera.position.z;
          const groundY = HILLS.height(b.x, b.z) + 0.5;
          if (budTimes[i] !== null) {
            budTimes[i] += dt;
            if (budTimes[i] > 0.25) {
              dummy.position.set(lx, -500, lz);
              dummy.scale.setScalar(0.001);
            } else {
              const sc = 1 - budTimes[i] / 0.25;
              dummy.position.set(lx, groundY, lz);
              dummy.scale.setScalar(sc * KIND_SCALE[kind]);
            }
          } else {
            const sc = 1 + Math.sin(timeSec * 2.5 + i) * 0.06;
            dummy.position.set(lx, groundY, lz);
            dummy.scale.setScalar(sc * KIND_SCALE[kind]);
          }
          dummy.updateMatrix();
          mesh.setMatrixAt(local, dummy.matrix);
        }
        for (const m of budMeshes) m.instanceMatrix.needsUpdate = true;
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

      // Camera trails behind (larger z) and above the petal, looking ahead.
      const target = new THREE.Vector3(petalPos.x * 0.6, petalPos.y * 0.55 + 4.2, petalPos.z + 11);
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30);
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
      world.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
    budMeshes = [];
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
      world.add(mesh);
      budMeshes[k] = mesh;
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