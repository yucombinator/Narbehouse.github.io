import * as THREE from 'three';
import { initRender, resize } from './render.js';
import { generateTrail } from './trail.js';
import { advance } from './steer.js';
import { collectBud, tintFor } from './growth.js';
import { noteFor } from './notes.js';
import { initAudio } from './audio.js';

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
window.addEventListener('error', (e) => {
  window.__lastError = (e.error && e.error.stack) || e.message;
});
window.addEventListener('unhandledrejection', (e) => {
  window.__lastError = 'REJECTION: ' + (e.reason && e.reason.stack) || String(e.reason);
});
// Debug/test hook: teleport the petal and read game state (used by smoke tests).
window.__petalGame = {
  teleport(x, z) {
    petal = { x, z, bank: 0, y: trail.pointAt(z).y };
  },
  	state() {
		return { size, meadowBuds, meadowTotal, collected: collectedSet.size };
	},
	bud(i) {
		return trail.buds[i] ? { x: trail.buds[i].x, y: trail.buds[i].y, z: trail.buds[i].z } : null;
	},
};

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
let meadowBuds = 0;
let meadowTotal = trail.buds.length;
let size = 1;
const clock = new THREE.Clock();
render.setTrail(trail.buds, trail.mother);
const audio = initAudio();

const COLLECT_RADIUS = 0.8; // base horizontal collect distance
const MAX_SIZE = 2.5;

function checkCollection() {
  const best = { i: -1, d: Infinity };
  for (let i = 0; i < trail.buds.length; i++) {
    const b = trail.buds[i];
    if (collectedSet.has(i)) continue;
    const d = Math.hypot(b.x - petal.x, b.z - petal.z);
    if (d < best.d) {
      best.i = i;
      best.d = d;
    }
  }
  if (best.i >= 0 && best.d < COLLECT_RADIUS + size * 0.5) {
    const st = collectBud({ size, meadowBuds, meadowTotal });
    size = st.size;
    meadowBuds = st.meadowBuds;
    collectedSet.add(best.i);
    render.collectPop(best.i);
    if (audio) audio.chime(noteFor(collectedLifetimeTotal++));
    updateHud();
  }
}

function updateHud() {
	const hud = document.getElementById('hudCount');
	if (hud) hud.textContent = `${meadowBuds} / ${meadowTotal}`;
	const ring = document.getElementById('sizeRingFg');
	if (ring) {
		const p = meadowTotal ? meadowBuds / meadowTotal : 0;
		ring.style.strokeDashoffset = String(113.1 * (1 - p));
	}
}

let collectedSet = new Set();
let collectedLifetimeTotal = 0;

function loop() {
	const dt = Math.min(clock.getDelta(), 1 / 20);
	const m = advance(petal, dt, {}, input.left, input.right);
	const p = trail.pointAt(m.z);
	petal = { ...m, y: p.y }; // carry altitude (advance returns x,z,bank only)
	checkCollection();
	render.setPetalSize(size);
	render.setPetalTint(tintFor((size - 1) / (MAX_SIZE - 1)));
	render.frame(dt, { x: petal.x, y: petal.y }, petal.bank, clock.elapsedTime);
	render.renderer.render(render.scene, render.camera);
	requestAnimationFrame(loop);
}
requestAnimationFrame(loop);