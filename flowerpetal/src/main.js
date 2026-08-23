import * as THREE from 'three';
import { initRender, resize } from './render.js?v=4';
import { generateTrail, CRUISE_SPEED } from './trail.js?v=2';
import { advance } from './steer.js';
import { collectBud, tintFor } from './growth.js';
import { noteFor } from './notes.js';
import { initAudio } from './audio.js';
import { nextMeadow } from './meadow.js';
import { loadSave, writeSave, resetSave } from './state.js';
import { windAt } from './wind.js';
import { HILLS } from './hill.js';

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
let isTitleOpen = true; // Space/Enter start the game while the title is up
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
	// While the title screen is up, Space/Enter belong to Start.
	if (isTitleOpen && (e.key === ' ' || e.key === 'Enter')) return;
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
function canvasSteer(e, value) {
  const left = e.clientX < window.innerWidth / 2;
  if (left) input.left = value;
  else input.right = value;
}
canvas.addEventListener('pointerdown', (e) => {
  // Capture so a drag that leaves the canvas still releases cleanly.
  canvas.setPointerCapture(e.pointerId);
  canvasSteer(e, true);
});
canvas.addEventListener('pointerup', (e) => canvasSteer(e, false));
canvas.addEventListener('pointercancel', (e) => canvasSteer(e, false));
canvas.addEventListener('pointerleave', () => {
  input.left = false;
  input.right = false;
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
let petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0, y: trail.pointAt(trail.zStart).y };

// Invariant: the petal never dips below the terrain. Applied every frame so
// wind, assist, or teleports cannot bury us underground.
function clampAboveGround() {
  const floor = HILLS.height(petal.x, petal.z) + 0.8;
  if (petal.y < floor) petal.y = floor;
}
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
// 3D models used by the game. Several are CC Attribution — they must stay
// credited as long as they ship. `loaded` flips true when the asset is found.
const MODEL_CREDITS = [
  {
    id: 'cherry-petal',
    name: 'Cherry blossom petal',
    author: 'Voyage (@voyagevoyage_vr)',
    license: 'CC Attribution 4.0 (CC BY)',
    url: 'https://sketchfab.com/3d-models/cherry-blossom-petal-a1e45d9f9796403ca855a6afa4613627',
    file: 'assets/cherry-blossom-petal.obj',
    used: false,
  },
];

// Parse a tiny Wavefront OBJ (positions + faces) into a THREE.BufferGeometry.
// Kept local so no loader dependency is needed for this 26-triangle model.
function geometryFromObj(text) {
  const verts = [];
  const faces = [];
  for (const line of text.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === 'v') verts.push([+parts[1], +parts[2], +parts[3]]);
    else if (parts[0] === 'f') {
      const idx = parts.slice(1).map((p) => parseInt(p.split('/')[0], 10) - 1);
      if (idx.length >= 3) faces.push(idx);
    }
  }
  // Triangulate (all faces here are triangles) and rebuild positions/normals.
  const positions = [];
  const normals = [];
  for (const f of faces) {
    if (f.length === 3) {
      const a = verts[f[0]];
      const b = verts[f[1]];
      const c = verts[f[2]];
      positions.push(...a, ...b, ...c);
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      for (let i = 0; i < 3; i++) normals.push(nx / len, ny / len, nz / len);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.computeBoundingBox();
  // Bake a vertical light gradient into vertex colors (base darker → tip
  // lighter) so the petal always shows gentle form, independent of lights.
  const bb = g.boundingBox;
  const dz = bb.max.z - bb.min.z;
  const dx = bb.max.x - bb.min.x;
  const dy = bb.max.y - bb.min.y;
  const longAxis = dz >= dx && dz >= dy ? 2 : dx >= dy ? 0 : 1;
  const span = Math.max(1e-6, bb.max.getComponent(longAxis) - bb.min.getComponent(longAxis));
  const col = new Float32Array(positions.length);
  for (let i = 0; i < positions.length / 3; i++) {
    const v = positions[i * 3 + longAxis];
    const t = THREE.MathUtils.clamp((v - bb.min.getComponent(longAxis)) / span, 0, 1);
    const bright = 0.68 + t * 0.32;
    col[i * 3] = bright; col[i * 3 + 1] = bright; col[i * 3 + 2] = bright;
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

const AMBIENT_KEY = 'petalBloom.ambient';
const ambientCheck = document.getElementById('ambientOn');
if (ambientCheck) {
  // Restore the player's ambient preference (default on).
  try {
    ambientCheck.checked = storage.getItem(AMBIENT_KEY) !== '0';
  } catch {
    ambientCheck.checked = true;
  }
  const applyAmbient = () => {
    const on = ambientCheck.checked;
    try {
      storage.setItem(AMBIENT_KEY, on ? '1' : '0');
    } catch { /* storage unavailable */ }
    if (!audio) return;
    if (on) audio.startAmbient();
    else audio.stopAmbient();
  };
  ambientCheck.addEventListener('change', applyAmbient);
  // M toggles ambient music at any time.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      ambientCheck.checked = !ambientCheck.checked;
      ambientCheck.dispatchEvent(new Event('change'));
      e.preventDefault();
    }
  });
}

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
    render.resetTrail(); // don't let petals trail through stale teleport paths
  },
  state() {
    return { size, meadowBuds, meadowTotal, collected: collectedSet.size, blooms, seed: meadowSeed, allBloomed };
  },
  bud(i) {
    return trail.buds[i]
      ? { x: trail.buds[i].x, y: trail.buds[i].y, z: trail.buds[i].z, colorHex: trail.buds[i].colorHex }
      : null;
  },
  mother() {
    return { x: trail.mother.x, y: trail.mother.y, z: trail.mother.z };
  },
};
window.__petalAudio = audio;

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
    render.addPetal(trail.buds[best.i].colorHex); // a new petal joins the ring
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
  petal = { x: trail.pointAt(trail.zStart).x + 2, z: trail.zStart, bank: 0, y: trail.pointAt(trail.zStart).y };
  meadowBuds = 0;
  meadowTotal = trail.buds.length;
  collectedSet = new Set();
  allBloomed = false;
  render.setTrail(trail.buds, trail.mother);
  render.resetTrail(); // new meadow = new ribbon
  saveProgress();
  updateHud();
}

const FLOAT_ALT = 3.2; // cruise height above terrain when no flowers to catch
function flightTargetY() {
  // We follow the terrain at FLOAT_ALT, but dip down toward an uncollected
  // flower when one is close ahead — "float up when there's nothing to catch".
  const base = HILLS.height(petal.x, petal.z) + FLOAT_ALT;
  let nearestY = null;
  let nearestD = Infinity;
  for (let i = 0; i < trail.buds.length; i++) {
    if (collectedSet.has(i)) continue;
    const b = trail.buds[i];
    if (b.z > petal.z + 6 || b.z < petal.z - 26) continue; // ahead window
    const d = Math.hypot(b.x - petal.x, b.z - petal.z);
    if (d < nearestD) {
      nearestD = d;
      nearestY = b.y;
    }
  }
  if (nearestY !== null && nearestD < 20) {
    const mix = 1 - nearestD / 20; // dip harder the closer the flower
    return base - mix * (base - nearestY);
  }
  return base;
}

// Progressive centering: the further the player drifts from the trail's
// centerline, the harder it pulls back — so reaching far out takes visibly
// more effort, without a hard wall. Near the line it's a gentle guide.
const CENTER_K = 0.3;    // pull factor at the origin (gentle)
const CENTER_BIAS = 1.3; // how much the pull grows per unit of offset
const CENTER_CAP = 6.5;  // max pull speed, u/s
// The player can hold max-bank (sin(35°)*6 ≈ 3.44 u/s lateral) toward the
// edge; with these values the pull meets steering around ~3-4 units out,
// so straying beyond ~4 quickly costs real effort and ~7+ is hard to hold.

function elasticCenter(dt) {
  const centerX = trail.pointAt(petal.z).x;
  const err = centerX - petal.x;
  // Pull rate grows with offset: near the line it's gentle, far out it's
  // strong. Clamped so it always feels physical, never snaps.
  const pullMag = CENTER_K + CENTER_BIAS * Math.min(14, Math.abs(err));
  const pull = Math.max(-CENTER_CAP, Math.min(CENTER_CAP, err * pullMag));
  petal.x += pull * dt;
}

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const wind = windAt(clock.elapsedTime, meadowSeed);
  const m = advance(petal, dt, { speed: CRUISE_SPEED * wind.speedFactor }, input.left, input.right);
  petal = { x: m.x + wind.swayVx * dt, z: m.z, y: petal.y + wind.bobY * dt, bank: m.bank };
  const p = trail.pointAt(petal.z);
  const targetY = flightTargetY();
  // Ease altitude toward the target for a smooth guided float.
  petal.y += (targetY - petal.y) * Math.min(1, dt * 2.2);
  clampAboveGround(); // safety net: never under the hills
  elasticCenter(dt); // weak rubber-band pull back to the path
  clampAboveGround(); // clamps again after lateral pulls
  windAssist(dt);
  clampAboveGround();
  checkCollection();
  bloomCheck();
  render.setPetalSize(size);
  render.setPetalGlow((size - 1) / (MAX_SIZE - 1));
  const windLean = Math.max(-0.3, Math.min(0.3, wind.swayVx * 0.3));
  // Wind effect level (0..1): steering is the big push, but the ambient wind
  // current always contributes a little so there is visible motion at rest.
  const ambWind = Math.abs(wind.swayVx);
  const windLevel = Math.min(1, (input.left || input.right ? 0.75 : 0) + ambWind * 0.5);
  render.frame(dt, { x: petal.x, y: petal.y, z: petal.z }, petal.bank + windLean, clock.elapsedTime, windLevel);
  render.renderer.render(render.scene, render.camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// --- Title / reset flow ------------------------------------------------
const titleEl = document.getElementById('title');
const confirmEl = document.getElementById('confirm');
const btnStart = document.getElementById('btnStart');
const btnReset = document.getElementById('btnReset');
const btnCancelReset = document.getElementById('btnCancelReset');
const btnDoReset = document.getElementById('btnDoReset');
const btnCredits = document.getElementById('btnCredits');
const creditsEl = document.getElementById('credits');
const creditList = document.getElementById('creditList');
const btnCreditsClose = document.getElementById('btnCreditsClose');

function renderCredits() {
  if (!creditList) return;
  creditList.innerHTML = '';
  for (const m of MODEL_CREDITS) {
    const li = document.createElement('li');
    li.innerHTML =
      `<strong>${m.name}</strong> — ${m.author}<br>` +
      `License: ${m.license} — ` +
      `<a href="${m.url}" target="_blank" rel="noopener">source</a>` +
      ` <span class="credit-status">[${m.used ? 'in use' : 'not loaded'}]</span>`;
    creditList.appendChild(li);
  }
}
function openCredits() {
  renderCredits();
  creditsEl.classList.add('show');
  btnCreditsClose.focus();
}
function closeCredits() {
  creditsEl.classList.remove('show');
  btnCredits.focus();
}
if (btnCredits) btnCredits.addEventListener('click', openCredits);
if (btnCreditsClose) btnCreditsClose.addEventListener('click', closeCredits);

// Keyboard: Escape closes the credits; Space/Enter opens when focused.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCredits();
  const crOpen = creditsEl.classList.contains('show');
  if (crOpen && (e.key === ' ' || e.key === 'Enter') && document.activeElement === btnCreditsClose) {
    closeCredits();
    e.preventDefault();
  }
});

// Load the CC-BY cherry-blossom petal (GLB) if present; fall back to the
// procedural petal until then so the game always runs.
async function loadModelAssets() {
  const rec = MODEL_CREDITS.find((m) => m.id === 'cherry-petal');
  try {
    const text = await (await fetch(`./${rec.file}`)).text();
    const geo = geometryFromObj(text);
    if (geo.attributes.position.count === 0) return;
    // Normalise to the old petal blade length (~0.83 units along z).
    geo.computeBoundingBox();
    const size = geo.boundingBox.getSize(new THREE.Vector3());
    const k = 0.83 / Math.max(1e-6, size.z);
    geo.scale(k, k, k);
    // Lay the petal flat-ish facing +z like the procedural blade.
    geo.rotateY(Math.PI / 2);
    render.setPetalGeometry(geo);
    rec.used = true;
  } catch {
    /* model unavailable — procedural petal stays */
  }
}
loadModelAssets();

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
	isTitleOpen = false;
	loadProgress();
	render.setPetalSize(size);
	render.setPetalCount(Math.min(8, 1 + Math.floor(totalBuds)));
	render.setPetalGlow((size - 1) / (MAX_SIZE - 1));
	// Begin the ambient pad on this user gesture (autoplay policy).
	if (audio && ambientCheck && ambientCheck.checked) audio.startAmbient();
	render.resetTrail(); // fresh ribbon from the starting path, no stale slots
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
  petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0, y: trail.pointAt(trail.zStart).y };
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