import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

// A radially symmetric 5-petal flower lying in the XY plane (faces the camera).
// Used for trail buds and the mother bloom.
function buildFlowerGeometry({ petalRadius = 0.5, centerRadius = 0.26, petals = 5 } = {}) {
  const parts = [];
  const petalGeo = new THREE.SphereGeometry(petalRadius, 8, 6);
  petalGeo.scale(1, 1, 0.28); // flatten along z so it reads as a flat flower
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const g = petalGeo.clone();
    g.rotateZ(a);
    g.translate(Math.cos(a) * petalRadius * 1.15, Math.sin(a) * petalRadius * 1.15, 0);
    parts.push(g);
  }
  parts.push(new THREE.SphereGeometry(centerRadius, 10, 8));
  return mergeGeometries(parts);
}

const BUD_FLOWER = buildFlowerGeometry({ petalRadius: 0.55, centerRadius: 0.24 });
const MOTHER_FLOWER = buildFlowerGeometry({ petalRadius: 1.15, centerRadius: 0.5 });

// A single petal: a flattened ellipsoid elongated along +x, so it can be
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

  // Ground: huge soft disc slightly below the trail valley.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(400, 48),
    new THREE.MeshStandardMaterial({ color: 0xb9e6a0, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3;
  scene.add(ground);

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
  let budMesh = null;
  let budData = []; // {x,y,z,colorHex}
  let budTimes = []; // seconds since collected (null = active)
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
      return { petalCount: petalColors.length, budVertices: BUD_FLOWER.getAttribute('position').count };
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

      // Pulse remaining buds subtly; shrink collected ones out.
      if (budMesh) {
        const dummy = new THREE.Object3D();
        for (let i = 0; i < budData.length; i++) {
          const b = budData[i];
          if (!b) continue;
          let scale = 1;
          if (budTimes[i] !== null) {
            budTimes[i] += dt;
            if (budTimes[i] > 0.25) {
              dummy.scale.setScalar(0);
            } else {
              scale = 1 - budTimes[i] / 0.25;
            }
          } else {
            scale = 1 + Math.sin(timeSec * 2.5 + i) * 0.06;
          }
          dummy.position.set(b.x, b.y, b.z);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          budMesh.setMatrixAt(i, dummy.matrix);
        }
        budMesh.instanceMatrix.needsUpdate = true;
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
      // visibly scrolls forward as the petal flies down the trail.
      sky.position.copy(camera.position);
      ground.position.set(0, -3, camera.position.z);
      for (const c of clouds) {
        c.position.x += c.userData.speed * dt;
        if (c.position.x > 140) c.position.x = -140;
        c.position.z = camera.position.z + c.userData.zo;
      }

      // Camera trails behind (larger z) and above the petal, looking ahead (-z).
      const target = new THREE.Vector3(petalPos.x * 0.6, petalPos.y * 0.55 + 4.2, petalPos.z + 11);
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petalPos.x * 0.9, petalPos.y * 0.9, petalPos.z - 30);
    },
  };

  function scaleBuds(buds) {
    budData = buds;
    budTimes = buds.map(() => null);
    const count = buds.length;
    if (budMesh) {
      scene.remove(budMesh);
      budMesh.geometry.dispose();
    }
    budMesh = new THREE.InstancedMesh(BUD_FLOWER, new THREE.MeshBasicMaterial({ color: 0xffffff }), count);
    budMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(buds[i].x, buds[i].y, buds[i].z);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      budMesh.setMatrixAt(i, dummy.matrix);
    }
    budMesh.instanceMatrix.needsUpdate = true;
    // Per-bud tint via instance colors.
    for (let i = 0; i < count; i++) {
      budMesh.setColorAt(i, new THREE.Color(buds[i].colorHex));
    }
    scene.add(budMesh);
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