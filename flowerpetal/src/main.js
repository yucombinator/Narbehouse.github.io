import * as THREE from 'three';
import { initRender, resize } from './render.js';
import { generateTrail } from './trail.js';
import { advance } from './steer.js';

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

// --- Input: two buttons, LEFT and RIGHT -------------------------------
const input = { left: false, right: false };

function bindHold(el, key) {
  if (!el) return;
  const set = (v) => () => { input[key] = v; };
  el.addEventListener('pointerdown', set(true));
  el.addEventListener('pointerup', set(false));
  el.addEventListener('pointercancel', set(false));
  el.addEventListener('pointerleave', set(false));
}

const btnL = document.getElementById('btnL');
const btnR = document.getElementById('btnR');
bindHold(btnL, 'left');
bindHold(btnR, 'right');

function keyIsLeft(e) {
  return e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' || e.key === ' ';
}
function keyIsRight(e) {
  return e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' || e.key === 'Enter';
}
window.addEventListener('keydown', (e) => {
  if (keyIsLeft(e)) { input.left = true; e.preventDefault(); }
  if (keyIsRight(e)) { input.right = true; e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  if (keyIsLeft(e)) input.left = false;
  if (keyIsRight(e)) input.right = false;
});

// Canvas halves steer too.
canvas.addEventListener('pointerdown', (e) => {
  const left = e.clientX < window.innerWidth / 2;
  if (left) input.left = true;
  else input.right = true;
});
canvas.addEventListener('pointerup', (e) => {
  const left = e.clientX < window.innerWidth / 2;
  if (left) input.left = false;
  else input.right = false;
});

// Steering buttons (created in JS for now; index.html overlays come in Task 8).
for (const [id, key, label] of [['btnL', 'left', '◀ LEFT'], ['btnR', 'right', 'RIGHT ▶']]) {
	const d = document.createElement('div');
	d.id = id;
	d.textContent = label;
	d.style.cssText =
		'position:fixed;bottom:24px;font-size:28px;font-weight:bold;color:#5a2a4a;' +
		'background:rgba(255,255,255,0.75);border:3px solid #5a2a4a;border-radius:20px;' +
		'padding:18px 30px;user-select:none;touch-action:none;cursor:pointer;z-index:10;' +
		(key === 'left' ? 'left:24px;' : 'right:24px;');
	document.body.appendChild(d);
	bindHold(d, key);
}

// --- Game state --------------------------------------------------------
const trail = generateTrail({ seed: 42 });
let petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0 };
const clock = new THREE.Clock();

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  petal = advance(petal, dt, {}, input.left, input.right);
  const p = trail.pointAt(petal.z);
  render.frame(dt, { x: petal.x, y: p.y }, petal.bank);
  render.renderer.render(render.scene, render.camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);