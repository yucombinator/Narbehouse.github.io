import * as THREE from 'three';
import { initRender, resize } from './render.js';
import { generateTrail } from './trail.js';
import { advance } from './steer.js';
import { collectBud, tintFor } from './growth.js';
import { noteFor } from './notes.js';
import { initAudio } from './audio.js';
import { nextMeadow } from './meadow.js';
import { loadSave, writeSave, resetSave } from './state.js';

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

// --- Input: two buttons, LEFT and RIGHT -------------------------------
const input = { left: false, right: false };

function bindHold(el, key) {
  if (!el) return;
  const set = (v) => () => {
    input[key] = v;
  };
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
  if (keyIsLeft(e)) {
    input.left = true;
    e.preventDefault();
  }
  if (keyIsRight(e)) {
    input.right = true;
    e.preventDefault();
  }
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

// Steering buttons (created in JS; overlays come in Task 8).
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
const WIND_THRESHOLD = 16; // lateral distance before wind assist kicks in
const WIND_FORCE = 1.2; // lateral nudge, world units/s
const COLLECT_RADIUS = 0.8; // base horizontal collect distance
const MAX_SIZE = 2.5;
const BLOOM_REACH = 5; // distance to mother bloom that ends a meadow

let meadowSeed = 42;
let trail = generateTrail({ seed: meadowSeed });
let petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0 };
let meadowBuds = 0;
let meadowTotal = trail.buds.length;
let size = 1;
let blooms = 0;
let totalBuds = 0;
let collectedSet = new Set();
let collectedLifetimeTotal = 0;
let allBloomed = false;
const clock = new THREE.Clock();
render.setTrail(trail.buds, trail.mother);
const audio = initAudio();
const storage = (() => {
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
})();

function saveProgress() {
  if (!storage) return;
  writeSave(storage, { size, totalBuds, blooms });
}

function loadProgress() {
  if (!storage) return;
  const s = loadSave(storage);
  if (!s) return;
  size = s.size;
  totalBuds = s.totalBuds;
  blooms = s.blooms;
}

function resetProgress() {
  if (storage) resetSave(storage);
  size = 1;
  totalBuds = 0;
  blooms = 0;
}

// Debug/test hook (used by smoke tests).
window.__petalGame = {
  teleport(x, z) {
    petal = { x, z, bank: 0, y: trail.pointAt(z).y };
  },
  state() {
    return { size, meadowBuds, meadowTotal, collected: collectedSet.size, blooms, seed: meadowSeed, allBloomed };
  },
  bud(i) {
    return trail.buds[i] ? { x: trail.buds[i].x, y: trail.buds[i].y, z: trail.buds[i].z } : null;
  },
  mother() {
    return { x: trail.mother.x, y: trail.mother.y, z: trail.mother.z };
  },
};

function updateHud() {
  const hud = document.getElementById('hudCount');
  if (hud) {
    hud.textContent = allBloomed ? 'BLOOM!' : `${meadowBuds} / ${meadowTotal}`;
  }
  const ring = document.getElementById('sizeRingFg');
  if (ring) {
    const p = meadowTotal ? meadowBuds / meadowTotal : 0;
    ring.style.strokeDashoffset = String(113.1 * (1 - p));
  }
}

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
    if (audio) audio.chime(noteFor(totalBuds + collectedSet.size)); // ladder continues across meadows
    if (st.doesBloom) {
      allBloomed = true;
      if (audio) audio.bloomChord();
    }
    saveProgress();
    updateHud();
  }
}

function windAssist(dt) {
  // Gently pull the petal back toward the nearest uncollected bud when far off.
  if (allBloomed) return;
  let bestD = Infinity;
  for (let i = 0; i < trail.buds.length; i++) {
    if (collectedSet.has(i)) continue;
    const d = Math.abs(trail.buds[i].x - petal.x);
    if (d < bestD) bestD = d;
  }
  if (bestD > WIND_THRESHOLD) {
    let dir = 0;
    let best = Infinity;
    for (let i = 0; i < trail.buds.length; i++) {
      if (collectedSet.has(i)) continue;
      const d = Math.abs(trail.buds[i].x - petal.x);
      if (d < best) {
        best = d;
        dir = Math.sign(trail.buds[i].x - petal.x);
      }
    }
    petal.x += dir * WIND_FORCE * dt;
  }
}

function bloomCheck() {
  if (!allBloomed) return;
  const d = Math.hypot(trail.mother.x - petal.x, trail.mother.z - petal.z);
  if (d > BLOOM_REACH) return;
  const next = nextMeadow({ seed: meadowSeed, blooms, size, totalBuds, meadowBuds });
  meadowSeed = next.seed;
  blooms = next.blooms;
  totalBuds = next.totalBuds;
  trail = generateTrail({ seed: meadowSeed });
  petal = { x: trail.pointAt(trail.zStart).x + 2, z: trail.zStart, bank: 0, y: 6 };
  meadowBuds = 0;
  meadowTotal = trail.buds.length;
  collectedSet = new Set();
  allBloomed = false;
  render.setTrail(trail.buds, trail.mother);
  saveProgress();
  updateHud();
}

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const m = advance(petal, dt, {}, input.left, input.right);
  const p = trail.pointAt(m.z);
  petal = { ...m, y: p.y }; // carry altitude (advance returns x,z,bank only)
  windAssist(dt);
  checkCollection();
  bloomCheck();
  render.setPetalSize(size);
  render.setPetalTint(tintFor((size - 1) / (MAX_SIZE - 1)));
  render.frame(dt, { x: petal.x, y: petal.y }, petal.bank, clock.elapsedTime);
  render.renderer.render(render.scene, render.camera);
  requestAnimationFrame(loop);
}

// --- Title / reset flow ------------------------------------------------
const titleEl = document.getElementById('title');
const confirmEl = document.getElementById('confirm');
const btnStart = document.getElementById('btnStart');
const btnReset = document.getElementById('btnReset');
const btnCancelReset = document.getElementById('btnCancelReset');
const btnDoReset = document.getElementById('btnDoReset');

let started = false;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeConfirm();
  if (!started && (e.key === ' ' || e.key === 'Enter')) {
    startGame();
    e.preventDefault();
  }
});

function startGame() {
  if (started) return;
  started = true;
  loadProgress();
  render.setPetalSize(size);
  render.setPetalTint(tintFor((size - 1) / (MAX_SIZE - 1)));
  titleEl.style.display = 'none';
  updateHud();
}

function openConfirm() {
  confirmEl.classList.add('show');
  btnCancelReset.focus();
}
function closeConfirm() {
  confirmEl.classList.remove('show');
  btnReset.focus();
}
function doReset() {
  resetProgress();
  // Return the petal to its starting meadow, at starting size.
  meadowSeed = 42;
  trail = generateTrail({ seed: meadowSeed });
  petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0, y: 6 };
  meadowBuds = 0;
  meadowTotal = trail.buds.length;
  collectedSet = new Set();
  allBloomed = false;
  render.setTrail(trail.buds, trail.mother);
  closeConfirm();
  updateHud();
}

btnStart.addEventListener('click', startGame);
btnReset.addEventListener('click', () => (started ? openConfirm() : openConfirm()));
btnCancelReset.addEventListener('click', closeConfirm);
btnDoReset.addEventListener('click', doReset);

// Start on load is not automatic; the title screen waits for the player.
loadProgress();
requestAnimationFrame(loop);