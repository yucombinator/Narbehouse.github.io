import * as THREE from 'three';

export const SKY_TOP = 0x9fd8ff;
export const SKY_BOTTOM = 0xffe3f0;

const BUD_RADIUS = 0.45; // world units, visual size of a bud

export function initRender(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(SKY_BOTTOM, 90, 320);
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 10, -14);

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

  // Petal geometry.
  const petalGeo = new THREE.SphereGeometry(0.55, 24, 18);
  petalGeo.scale(0.62, 0.16, 1);
  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xff9ec0,
    emissive: 0x9a3f66,
    emissiveIntensity: 0.55,
    roughness: 0.4,
  });
  const petal = new THREE.Group();
  const petalMesh = new THREE.Mesh(petalGeo, petalMat);
  petal.add(petalMesh);
  scene.add(petal);

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(30, 60, 20);
  scene.add(ambient, sun);

  // --- Buds (instanced) + mother bloom -------------------------------
  const budGeo = new THREE.SphereGeometry(BUD_RADIUS, 10, 8);
  const budMat = new THREE.MeshBasicMaterial({ color: 0xffd1dc });
    let budMesh = null;
  let budData = []; // {x,y,z,colorHex}
  let budTimes = []; // seconds since collected (null = active)
  const pops = []; // {x,y,z,life} collection bursts

  // Mother bloom: single larger pulsing sphere at trail end.
  const motherMat = new THREE.MeshBasicMaterial({ color: 0xff9ecb, transparent: true, opacity: 0.95 });
  const mother = new THREE.Mesh(new THREE.SphereGeometry(1.4, 20, 14), motherMat);
  mother.visible = false;
  scene.add(mother);

  const api = {
    scene,
    camera,
    renderer,
    petal,
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
      pops.push({ x: b.x, y: b.y, z: b.z, life: 0 });
      budTimes[index] = 0;
    },
    setPetalSize(s) {
      petal.scale.setScalar(s);
    },
    setPetalTint(hex) {
      const c = new THREE.Color(hex);
      petalMat.color.copy(c);
      petalMat.emissive.copy(c).multiplyScalar(0.55);
    },
    frame(dt, petalPos, bank, timeSec) {
      petal.position.set(petalPos.x, petalPos.y, 0);
      petal.rotation.z = bank * 0.6;
      petal.rotation.x = Math.sin(timeSec * 2) * 0.08;

      // Pulse remaining buds subtly; grow collected ones out.
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
        // Tint every bud by its color (instanceColor).
        if (budMesh.instanceColor) budMesh.instanceColor.needsUpdate = true;
      }

      // Pops.
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].life += dt;
        if (pops[i].life > 0.5) pops.splice(i, 1);
      }

      // Mother bloom gentle pulse.
      if (mother.visible) {
        const m = 1 + Math.sin(timeSec * 1.8) * 0.08;
        mother.scale.setScalar(m);
        mother.rotation.y += dt * 0.4;
      }

      // Camera trails behind and above the petal.
      const target = new THREE.Vector3(petalPos.x * 0.6, petalPos.y * 0.55 + 4.2, -13);
      camera.position.lerp(target, 1 - Math.pow(0.0015, dt));
      camera.lookAt(petal.position.x * 0.9, petal.position.y * 0.9, 12);
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
    budMesh = new THREE.InstancedMesh(budGeo, budMat, count);
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

  api.setPetalSize(1);
  api.setPetalTint(0xffe3f0);
  return api;
}

export function resize(api) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  api.renderer.setSize(w, h);
  api.camera.aspect = w / h;
  api.camera.updateProjectionMatrix();
}