import * as THREE from 'three';
import { initRender, resize } from './render.js';
import { generateTrail } from './trail.js';

const canvasWrap = document.getElementById('game');
const canvas = document.createElement('canvas');
canvasWrap.appendChild(canvas);

let render;
try {
  render = initRender(canvas);
} catch (e) {
  window.__bootError = String((e && e.stack) || e);
  throw e;
}
window.addEventListener('resize', () => resize(render));
window.__petal = { render };

// Task 4 placeholder: cruise along the trail centerline to show the world.
// Real two-button steering replaces this in Task 5.
const trail = generateTrail({ seed: 42 });
let z = trail.zStart;
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  z += 6 * dt; // preset cruise speed
  if (z > trail.zEnd) z = trail.zStart;
  const p = trail.pointAt(z);
  render.frame(dt, { x: p.x, y: p.y }, 0);
  render.renderer.render(render.scene, render.camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);