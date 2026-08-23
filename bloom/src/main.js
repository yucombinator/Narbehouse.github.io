import * as THREE from 'three';
import { initRender, resize } from './render.js?v=14';
import { generateTrail, CRUISE_SPEED, FLOWER_KINDS } from './trail.js?v=3';
import { advance } from './steer.js';
import { collectBud, tintFor, stepSize } from './growth.js';
import { sampleChoices, flowerById, bouquetTitle, segmentMood } from './flowers.js';
import { TOTAL_STOPS, TOTAL_STAGES, createRun, reachStop, commitPick, beginCeremony, finishCeremony } from './run.js';
import { loadBouquets, addBouquet, resetBouquets } from './gallery.js';
import { composePostcard } from './poem.js?v=2';
import { basketSvg, bloomInBasketSvg, bouquetSvg, stampSvg } from './art.js';
import { mulberry32 } from './rand.js';
import { noteFor } from './notes.js';
import { initAudio } from './audio.js';
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
  // No WebGL? Keep every UI listener alive; only the 3D view is lost.
  window.__bootError = String((e && e.stack) || e);
  render = null;
}
window.addEventListener('resize', () => {
  if (render) resize(render);
});
window.__petal = { get render() { return render; } };
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
	if (isTitleOpen || paused) return;
	// While a meadow stop or ceremony is open, keys belong to those dialogs.
	if (isStopOpen || ceremonyOpen()) return;
	// Holding Return during play opens Pause; steering still sees the press.
	if (keyIsRight(e) && started && holdTimer === null && !e.repeat) {
		holdTimer = setTimeout(openPause, HOLD_RETURN_MS);
	}
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
  if (keyIsRight(e)) {
    clearTimeout(holdTimer);
    holdTimer = null;
    enterHeld = false;
  }
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

let meadowSeed = 42;
let trail = generateTrail({ seed: meadowSeed });
let petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0, y: trail.pointAt(trail.zStart).y };

// Invariant: the petal never dips below the terrain. Applied every frame so
// wind, assist, or teleports cannot bury us underground.
function clampAboveGround() {
  const floor = HILLS.height(petal.x, petal.z) + 1.4;
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
render?.setTrail(trail.buds, trail.mother);
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
    return { size, meadowBuds, meadowTotal, collected: collectedSet.size, blooms, seed: meadowSeed, allBloomed, openBuds: render?.budsOpened?.() ?? -1 };
  },
  bud(i) {
    return trail.buds[i]
      ? { x: trail.buds[i].x, y: trail.buds[i].y, z: trail.buds[i].z, colorHex: trail.buds[i].colorHex }
      : null;
  },
  mother() {
    return { x: trail.mother.x, y: trail.mother.y, z: trail.mother.z };
  },
  debugFillBasket(n) {
    buildBasket();
    const demo = ['poppy', 'oxeye-daisy', 'camas', 'dandelion', 'tulip'];
    for (let i = 0; i < Math.min(n, TOTAL_STOPS); i++) {
      basketBlooms?.insertAdjacentHTML('beforeend', bloomInBasketSvg(flowerById(demo[i]), i));
    }
  },
  runState() {
    return {
      phase: run.phase,
      stopsDone: run.stopsDone,
      picks: [...run.picks],
      stopOpen: isStopOpen,
      offer: isStopOpen ? [...stopOffer] : null,
      focused: isStopOpen ? stopFocus : null,
      stage: Math.min(stageIndex + 1, TOTAL_STAGES),
      cards: sessionCards.length,
      interludeOpen: ceremonyOpen(),
      spillBuds: trail.buds.filter((b) => b.cluster < 0).length,
      galleryCount: (() => {
        try {
          return loadBouquets(storage).length;
        } catch {
          return -1;
        }
      })(),
    };
  },
};
window.__petalAudio = audio;

function updateHud() {
  const hud = document.getElementById('hudCount');
  if (hud) {
    // One text label for the meadow (stage); the flowers themselves show
    // stop progress — each bud fills in as that stop is picked.
    let dots = '';
    for (let i = 0; i < TOTAL_STOPS; i++) {
      const done = i < run.stopsDone;
      dots +=
        `<svg class="hudFlower${done ? ' done' : ''}" viewBox="0 0 20 20" aria-hidden="true">` +
        `<g fill="${done ? '#ff5ca0' : 'rgba(255,255,255,0.55)'}" stroke="${done ? '#d94f86' : 'rgba(90,42,74,0.45)'}" stroke-width="1.4">` +
        [0, 72, 144, 216, 288].map((a) => `<ellipse cx="10" cy="4.6" rx="3.1" ry="4.2" transform="rotate(${a} 10 10)"/>`).join('') +
        `</g><circle cx="10" cy="10" r="2.5" fill="${done ? '#ffd76e' : 'rgba(90,42,74,0.35)'}"/></svg>`;
    }
    hud.innerHTML =
      `<span class="hudTag">Meadow ${Math.min(stageIndex + 1, TOTAL_STAGES)} of ${TOTAL_STAGES}</span>` +
      `<span class="hudDots" role="img" aria-label="flowers gathered: ${run.stopsDone} of ${TOTAL_STOPS}" title="flowers gathered: ${run.stopsDone} of ${TOTAL_STOPS}">${dots}</span>`;
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
    // The picked flower's own petal flies in and joins the trailing wreath.
    render?.addPetal(trail.buds[best.i].colorHex, trail.buds[best.i]);
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

// --- Meadow stops & run flow -------------------------------------------
// A run is five meadow stops. Crossing a stop threshold freezes the world and
// opens the chooser (auto-scan highlight; Space steps, Enter picks). After
// the fifth pick the petal drifts into the bouquet ceremony.
let run = createRun(meadowSeed);
let stopZs = [];
// --- Hub-wide accessibility managers -------------------------------------
// The hub ships shared managers (bennyshub/shared/) that hold the player's
// global scan cadence and voice choice. Bloom defers to them when present
// and falls back to local settings when played standalone.
function narbeScan() { return window.NarbeScanManager || null; }
function narbeVoice() { return window.NarbeVoiceManager || null; }

// Local fallbacks (standalone play without the hub scripts).
const SCANMODE_KEY = 'petalBloom.scanMode';
const SCANMS_KEY = 'petalBloom.scanMs';
let autoScan = true; // Automatic: highlight advances on its own (one switch)
try { autoScan = storage.getItem(SCANMODE_KEY) !== 'manual'; } catch { /* no storage */ }
let scanIntervalMs = 2000; // unhurried: Ben has time to look and listen
try {
  const saved = parseInt(storage.getItem(SCANMS_KEY), 10);
  if ([1000, 2000, 3000, 4000].includes(saved)) scanIntervalMs = saved;
} catch { /* no storage */ }

function isAutoScan() {
  const sm = narbeScan();
  return sm ? !!sm.getSettings().autoScan : autoScan;
}

function currentScanInterval() {
  const sm = narbeScan();
  return sm ? sm.getScanInterval() : scanIntervalMs;
}

function armDialogTimer(fn, ms = currentScanInterval()) {
  // In Manual scanning the highlight only moves when Space is pressed.
  if (!isAutoScan()) return null;
  return setInterval(fn, ms);
}
let isStopOpen = false;
let stopTimer = null;
let stopFocus = 0;
let stopOffer = [];
let basketPicks = [];

function computeStopZs(t) {
  const top = t.zStart - 26;       // breathing room after spawn
  const reserve = t.zEnd + 46;     // scenery left for the final drift
  const span = (top - reserve) / TOTAL_STOPS;
  return Array.from({ length: TOTAL_STOPS }, (_, i) => top - (i + 0.82) * span);
}
stopZs = computeStopZs(trail);

// --- Spoken flower names -------------------------------------------------
const TTS_KEY = 'petalBloom.tts';
const ttsCheck = document.getElementById('ttsOn');
let ttsOn = true;
try { ttsOn = storage.getItem(TTS_KEY) !== '0'; } catch { /* no storage */ }
// The hub's voice manager is the source of truth when it's loaded.
if (narbeVoice()) {
  ttsOn = !!narbeVoice().getSettings().ttsEnabled;
  if (ttsCheck) ttsCheck.checked = ttsOn;
}
if (ttsCheck) ttsCheck.checked = ttsOn;
function applyTtsPref() {
  const want = !ttsCheck || ttsCheck.checked;
  const vm = narbeVoice();
  if (vm) {
    if (vm.getSettings().ttsEnabled !== want) vm.toggleTTS(); // syncs back via onSettingsChange
  } else {
    ttsOn = want;
    try { storage.setItem(TTS_KEY, ttsOn ? '1' : '0'); } catch { /* no storage */ }
  }
}
if (ttsCheck) ttsCheck.addEventListener('change', applyTtsPref);
function speak(text, rate = 1, onEnd = null) {
  if (!ttsOn || !('speechSynthesis' in window)) {
    if (onEnd) onEnd();
    return false;
  }
  try {
    hushSpeech();
    const vm = narbeVoice();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    if (vm) {
      // Speak with the player's hub-wide voice choice.
      const s = vm.getSettings();
      u.pitch = s.pitch;
      u.volume = s.volume;
      const v = vm.getCurrentVoice();
      if (v) u.voice = v;
    }
    if (onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    speechSynthesis.speak(u);
    return true;
  } catch {
    if (onEnd) onEnd();
    return false;
  }
}
function hushSpeech() {
  const vm = narbeVoice();
  if (vm) {
    try { vm.cancel(); return; } catch { /* fall through */ }
  }
  if ('speechSynthesis' in window) {
    try { speechSynthesis.cancel(); } catch { /* ignore */ }
  }
}

// --- Small UI helpers ----------------------------------------------------
const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

// Stylized SVG flower for the chooser cards and basket slots.
function flowerSvg(f, px = 80) {
  const petals = f.shape === 'puff' ? 8 : f.shape === 'cup' ? 4 : 6;
  let out = '';
  for (let i = 0; i < petals; i++) {
    const a = Math.round((i / petals) * 360);
    const cy = f.shape === 'cup' ? 28 : 22;
    out += `<ellipse cx="40" cy="${cy}" rx="10" ry="16" fill="${f.petalHex}" transform="rotate(${a} 40 40)"/>`;
  }
  const r = f.shape === 'puff' ? 14 : 11;
  out += `<circle cx="40" cy="40" r="${r}" fill="${f.centerHex}" stroke="rgba(0,0,0,0.15)" stroke-width="1"/>`;
  return `<svg viewBox="0 0 80 80" width="${px}" height="${px}" aria-hidden="true">${out}</svg>`;
}

// --- Basket HUD ----------------------------------------------------------
// A shaded wicker basket; picked blooms pop in along its opening.
const basketEl = document.getElementById('basket');
let basketBlooms = null;
function buildBasket() {
  if (!basketEl || basketBlooms) return;
  basketEl.innerHTML = basketSvg();
  basketBlooms = basketEl.querySelector('#basketBlooms');
}
function renderBasket() {
  buildBasket();
  if (basketBlooms) basketBlooms.innerHTML = '';
}
function addToBasket(f) {
  if (!basketBlooms || !f) return;
  const i = Math.max(0, basketPicks.length - 1);
  basketBlooms.insertAdjacentHTML('beforeend', bloomInBasketSvg(f, i));
}
renderBasket();

// --- Stop chooser UI -----------------------------------------------------
const stopEl = document.getElementById('stop');
const stopPromptEl = document.getElementById('stopPrompt');
const stopCardsEl = document.getElementById('stopCards');

function focusChoice(k, silent = false) {
  const n = stopOffer.length || 1;
  stopFocus = ((k % n) + n) % n;
  [...stopCardsEl.children].forEach((el, i) => el.classList.toggle('focused', i === stopFocus));
  // Zen rule: a stop that opens as you drift by stays silent. Names are
  // spoken only once you start making a choice (scan steps / auto-scan).
  if (!silent) speak(flowerById(stopOffer[stopFocus]).tts);
  clearInterval(stopTimer);
  stopTimer = armDialogTimer(() => focusChoice(stopFocus + 1));
}

function openStop() {
  if (isStopOpen || run.phase !== 'FLYING') return;
  run = reachStop(run);
  stopOffer = sampleChoices(run.seed, run.stopsDone); // slice for this stop
  stopFocus = 0;
  input.left = false;
  input.right = false;
  hushSpeech();
  stopPromptEl.textContent = `Meadow stop ${run.stopsDone + 1} of ${TOTAL_STOPS} — choose a flower`;
  stopCardsEl.innerHTML = '';
  stopOffer.forEach((id, k) => {
    const f = flowerById(id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'flowerCard';
    card.innerHTML = `${flowerSvg(f)}<span>${f.name}</span>`;
    card.addEventListener('click', () => commitFocused(k));
    stopCardsEl.appendChild(card);
  });
  isStopOpen = true;
  stopEl.classList.add('show');
  focusChoice(0, true); // silent until the player engages
}

function closeStop() {
  clearInterval(stopTimer);
  isStopOpen = false;
  stopEl.classList.remove('show');
}

function commitFocused(k) {
  if (!isStopOpen) return;
  const idx = typeof k === 'number' ? k : stopFocus;
  const f = flowerById(stopOffer[idx]);
  run = commitPick(run, f.id, stopOffer);
  closeStop();
  hushSpeech();
  basketPicks.push(f.id);
  addToBasket(f);
  size = stepSize(size);
  toast(`${f.name} added to your basket!`);
  updateHud();
  if (run.phase === 'FLYING') saveProgress();
}

// --- Interlude: read the haiku, mail the postcard ------------------------
// Each stage ends with one postcard. Ben hears its haiku (exactly once),
// then watches it fly into the mailbox — sent away, like a real letter.
// After the send-off he scans two gentle choices: fly on or rest.
const cerEl = document.getElementById('ceremony');
const cerTitle = document.getElementById('cerTitle');
const cerPoem = document.getElementById('poemLines');
const cerSub = document.getElementById('postSub');
const cerArt = document.getElementById('bouquetArt');
const cerStamp = document.getElementById('stampBox');
const cerPos = document.getElementById('interludePos');
const postcardEl = document.getElementById('postcard');
const btnFlyOn = document.getElementById('btnFlyOn');
const btnRest = document.getElementById('btnRest');
let lastNarration = null;

let stageIndex = 0;
let sessionCards = []; // [{ picks, seed, card }] — cleared only on page exit
let scanItems = [];
let scanFocus = 0;
let scanTimer = null;
let interludePhase = 'idle'; // 'reveal' → 'mailing' → 'choices' → 'idle'
let mailTimer = null;

function ceremonyOpen() {
  return !!cerEl && cerEl.classList.contains('show');
}

function fillPostcard(rec, dir = 0) {
  cerTitle.textContent = `Meadow No. ${rec.card.number}`;
  cerSub.textContent = '';
  cerPoem.innerHTML = rec.card.lines.map((l) => `<div class="poemLine">${l}</div>`).join('');
  cerArt.innerHTML = bouquetSvg(rec.picks, flowerById);
  cerStamp.innerHTML = stampSvg(rec.card.dominantId ? flowerById(rec.card.dominantId) : null);
  lastNarration = rec.card.narration;
  if (dir !== 0 && postcardEl) {
    // Deal the card in from the direction of travel.
    postcardEl.classList.remove('postcard-in-r', 'postcard-in-l');
    void postcardEl.offsetWidth; // restart the animation
    postcardEl.classList.add(dir > 0 ? 'postcard-in-r' : 'postcard-in-l');
  }
}

// Pause the auto-scan while a haiku is being spoken. The scan resumes from
// the utterance's own end event — however long the poem takes to read —
// never from a fixed timer.
function holdScanForSpeech(onDone) {
  clearInterval(scanTimer);
  const spoke = speak(lastNarration, 0.95, onDone);
  if (!spoke) onDone();
}

function focusScanItem(k) {
  const n = scanItems.length || 1;
  scanFocus = ((k % n) + n) % n;
  const item = scanItems[scanFocus];
  btnFlyOn.classList.toggle('scanFocused', false);
  btnRest.classList.toggle('scanFocused', false);
  clearInterval(scanTimer);
  if (item.act === 'next') {
    cerPos.textContent = 'Fly on to the next meadow?';
    btnFlyOn.classList.toggle('scanFocused', true);
    armInterludeTimer();
  } else {
    cerPos.textContent = 'Rest for today?';
    btnRest.classList.toggle('scanFocused', true);
    armInterludeTimer();
  }
}

function armInterludeTimer() {
  clearInterval(scanTimer);
  scanTimer = armDialogTimer(() => focusScanItem(scanFocus + 1));
}

function buildScanItems() {
  scanItems = [];
  if (stageIndex < TOTAL_STAGES - 1 || sessionCards.length < TOTAL_STAGES) {
    scanItems.push({ type: 'act', act: 'next' });
  }
  scanItems.push({ type: 'act', act: 'rest' });
}

// Send-off: the postcard flies into the mailbox and is gone for good.
function startMailing() {
  if (!ceremonyOpen() || interludePhase !== 'reveal') return;
  interludePhase = 'mailing';
  clearInterval(scanTimer);
  clearTimeout(haikuGuard); // narration is done or skipped
  cerPos.textContent = 'Off it goes…';
  cerEl.classList.add('mail-time');
  postcardEl.classList.remove('postcard-in-r', 'postcard-in-l');
  void postcardEl.offsetWidth; // restart from a clean transform
  postcardEl.classList.add('mailing');
  clearTimeout(mailTimer);
  mailTimer = setTimeout(() => {
    if (!ceremonyOpen()) return;
    cerEl.classList.add('mailed'); // pops the little flag up
    cerEl.classList.remove('pre-choices'); // choices take the stage
    audio?.chime?.(660); // gentle send-off chime
    speak('In the mail!');
    cerPos.textContent = 'Postcard mailed ✓';
    interludePhase = 'choices';
    buildScanItems();
    focusScanItem(0);
  }, 1500);
}

let haikuGuard = null;
function startReveal(rec) {
  interludePhase = 'reveal';
  cerEl.classList.add('pre-choices');
  cerPos.textContent = 'Your postcard is ready';
  cerEl.classList.remove('mail-time', 'mailed');
  postcardEl.classList.remove('mailing');
  fillPostcard(rec, rec.dealDir || 0);
  // The newest meadow's haiku is narrated exactly once; Enter replays it.
  // Safety net: if the utterance never reports its end (headless browsers,
  // wedged engines), the send-off still arrives.
  rec.narrated = true;
  const spoke = holdScanForSpeech(() => startMailing());
  clearTimeout(haikuGuard);
  if (spoke) haikuGuard = setTimeout(() => startMailing(), 12000);
}

function openInterlude(newestFirst = true) {
  buildScanItems();
  hushSpeech();
  cerEl.classList.add('show');
  const rec = sessionCards[sessionCards.length - 1];
  if (!rec) { closeInterlude(); return; }
  rec.dealDir = newestFirst ? 0 : -1; // final card drifts in from the left
  startReveal(rec);
}

function closeInterlude() {
  clearInterval(scanTimer);
  clearTimeout(mailTimer);
  clearTimeout(haikuGuard);
  interludePhase = 'idle';
  cerEl.classList.remove('show', 'mail-time', 'mailed', 'pre-choices');
  postcardEl.classList.remove('mailing');
  hushSpeech();
}

function toTitle() {
  closeInterlude();
  started = false;
  isTitleOpen = true;
  titleEl.style.display = '';
  btnStart.focus();
}

function flyNextStage() {
  started = true;
  isTitleOpen = false;
  loadProgress();
  runSeedCounter = (runSeedCounter + 1) >>> 0; // fresh offers each stage
  beginRun(runSeedCounter);
  applyDebugJump();
  render?.setPetalSize(size);
  render?.setPetalCount(Math.min(8, 1 + Math.floor(totalBuds)));
  render?.setPetalGlow((size - 1) / (MAX_SIZE - 1));
  // Begin the ambient pad on this user gesture (autoplay policy).
  if (audio && ambientCheck && ambientCheck.checked) audio.startAmbient();
  titleEl.style.display = 'none';
  updateHud();
}

function activateScanItem() {
  if (interludePhase !== 'choices') return; // choices unlock after the send-off
  const item = scanItems[scanFocus];
  if (!item) return;
  if (item.act === 'next') {
    closeInterlude();
    flyNextStage(); // stageIndex already advanced when the card was stamped
  } else {
    toTitle();
  }
}
if (btnFlyOn) btnFlyOn.addEventListener('click', () => { if (ceremonyOpen() && interludePhase === 'choices') activateScanItemAt('next'); });
if (btnRest) btnRest.addEventListener('click', () => { if (ceremonyOpen() && interludePhase === 'choices') activateScanItemAt('rest'); });
function activateScanItemAt(act) {
  closeInterlude();
  if (act === 'next') {
    flyNextStage();
  } else {
    toTitle();
  }
}

// --- Pause menu (hold Return anywhere in gameplay) ------------------------
const HOLD_RETURN_MS = 750;
const pauseEl = document.getElementById('pause');
const pauseItemsEl = document.getElementById('pauseItems');
let paused = false;
let pausePage = 'main'; // 'main' | 'settings'
let pauseFocus = 0;
let pauseTimer = null;
let holdTimer = null;
let enterHeld = false;

function pauseMenuItems() {
  if (pausePage === 'settings') {
    return [
      { label: () => `Voice narration: ${ttsOn ? 'On' : 'Off'}`, act: 'toggle-tts' },
      { label: () => `Ambient sound: ${ambientCheck && ambientCheck.checked ? 'On' : 'Off'}`, act: 'toggle-audio' },
      { label: () => `Scanning: ${isAutoScan() ? 'Automatic' : 'Manual — press Space'}`, act: 'toggle-scan' },
      { label: () => `Scan speed: ${currentScanInterval() / 1000} seconds`, act: 'cycle-scan-speed' },
      { label: () => 'Back', act: 'back' },
    ];
  }
  return [
    { label: () => 'Continue', act: 'continue' },
    { label: () => 'Restart meadow', act: 'restart' },
    { label: () => 'Settings', act: 'settings' },
    { label: () => 'Main menu', act: 'menu' },
    { label: () => 'Exit game', act: 'exit' },
  ];
}

function renderPauseItems() {
  const items = pauseMenuItems();
  pauseItemsEl.innerHTML = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pauseItem' + (i === pauseFocus ? ' scanFocused' : '');
    b.textContent = it.label();
    b.addEventListener('click', () => activatePauseItem(i));
    pauseItemsEl.appendChild(b);
  });
}

function focusPauseItem(k) {
  const n = pauseMenuItems().length;
  pauseFocus = ((k % n) + n) % n;
  renderPauseItems();
  clearInterval(pauseTimer);
  pauseTimer = armDialogTimer(() => focusPauseItem(pauseFocus + 1));
  speak(pauseMenuItems()[pauseFocus].label(), 1);
}

function armPauseScan() {
  clearInterval(pauseTimer);
  pauseTimer = armDialogTimer(() => focusPauseItem(pauseFocus + 1));
}

function openPause() {
  holdTimer = null;
  if (paused || !started || isTitleOpen || isStopOpen || ceremonyOpen()) return;
  paused = true;
  enterHeld = true; // ignore Enter auto-repeats until the held key is released
  input.left = false;
  input.right = false;
  hushSpeech();
  pausePage = 'main';
  pauseFocus = 0;
  pauseEl.classList.add('show');
  renderPauseItems();
  speak('Paused');
  focusPauseItem(0);
}

function closePause() {
  if (!paused) return;
  paused = false;
  clearInterval(pauseTimer);
  pauseEl.classList.remove('show');
  hushSpeech();
}

function restartStage() {
  closePause();
  // Same seed → the same meadow, flown again from its start.
  beginRun(runSeedCounter);
  applyDebugJump();
  render?.resetTrail();
  toast('Meadow restarted');
}

function exitGame() {
  window.close(); // usually blocked for non-script-opened tabs
  setTimeout(() => {
    toast('Close this tab to leave the meadow.');
    closePause();
    toTitle();
  }, 250);
}

function activatePauseItem(i = pauseFocus) {
  const it = pauseMenuItems()[i];
  switch (it.act) {
    case 'continue':
      closePause();
      break;
    case 'restart':
      restartStage();
      break;
    case 'settings':
      pausePage = 'settings';
      pauseFocus = 0;
      focusPauseItem(0);
      break;
    case 'back':
      pausePage = 'main';
      pauseFocus = 0;
      focusPauseItem(0);
      break;
    case 'menu':
      closePause();
      toTitle();
      break;
    case 'exit':
      exitGame();
      break;
    case 'toggle-scan': {
      const sm = narbeScan();
      if (sm) {
        sm.setAutoScan(!isAutoScan()); // hub-wide; syncs back via subscribe
      } else {
        autoScan = !autoScan;
        try { storage.setItem(SCANMODE_KEY, autoScan ? 'auto' : 'manual'); } catch { /* no storage */ }
      }
      renderPauseItems();
      speak(isAutoScan() ? 'Automatic scanning' : 'Manual scanning: press Space to move');
      armPauseScan();
      break;
    }
    case 'cycle-scan-speed': {
      const sm = narbeScan();
      if (sm) {
        sm.cycleScanSpeed(); // hub-wide speeds: 1s / 2s / 3s / 4s
      } else {
        const SPEEDS = [1000, 2000, 3000, 4000];
        scanIntervalMs = SPEEDS[(SPEEDS.indexOf(scanIntervalMs) + 1) % SPEEDS.length];
        try { storage.setItem(SCANMS_KEY, String(scanIntervalMs)); } catch { /* no storage */ }
      }
      renderPauseItems();
      speak(`${currentScanInterval() / 1000} second scanning`);
      armPauseScan();
      break;
    }
    case 'toggle-tts': {
      const vm = narbeVoice();
      if (vm) {
        vm.toggleTTS(); // hub-wide; syncs back via onSettingsChange
      } else {
        ttsOn = !ttsOn;
        try { storage.setItem(TTS_KEY, ttsOn ? '1' : '0'); } catch { /* no storage */ }
        if (ttsCheck) ttsCheck.checked = ttsOn;
        renderPauseItems();
      }
      speak(ttsOn ? 'Voice on' : 'Voice off');
      armPauseScan();
      break;
    }
    case 'toggle-audio': {
      if (ambientCheck) {
        ambientCheck.checked = !ambientCheck.checked;
        ambientCheck.dispatchEvent(new Event('change'));
        renderPauseItems();
        speak(ambientCheck.checked ? 'Ambient on' : 'Ambient off');
      }
      armPauseScan();
      break;
    }
  }
}

function openCeremony() {
  if (run.phase !== 'DRIFTING') return;
  run = beginCeremony(run);
  hushSpeech();
  run = finishCeremony(run, Date.now());
  try {
    if (storage) addBouquet(storage, run.bouquet);
  } catch { /* gallery unavailable */ }
  const card = composePostcard({ picks: run.picks, seed: run.seed, flowerById });
  const rec = { picks: [...run.picks], seed: run.seed, card };
  sessionCards.push(rec);
  stageIndex += 1; // the postcard is stamped: this stage counts as played
  fillPostcard(rec);
  openInterlude(true); // land on the freshly stamped postcard
}

// --- Fresh run / meadow tinting -----------------------------------------
// Accept both string ('#rrggbb') and numeric (0xrrggbb) colours — trail.js
// PALETTE entries are numbers. Returns null for anything unparseable.
function hexToRgb(c) {
  const h = typeof c === 'number' ? `#${c.toString(16).padStart(6, '0')}` : c;
  if (typeof h !== 'string' || !/^#[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const ch = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}
function mixHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  if (!A || !B) return a; // unknown colour format: leave untouched
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}

// Similar flowers grow together: lean each meadow stretch's bud colours
// toward one local variant's colour family. Spill buds (cluster < 0) already
// carry their stop's exact palette, so they're skipped.
function tintMeadowSegments() {
  for (let i = 0; i < trail.buds.length; i++) {
    const b = trail.buds[i];
    let seg = 0;
    while (seg < TOTAL_STOPS && b.z < stopZs[seg]) seg++;
    if (b.cluster < 0) continue;
    const mood = segmentMood(meadowSeed, Math.min(seg, TOTAL_STOPS - 1));
    if (mood && b.colorHex) b.colorHex = mixHex(b.colorHex, mood.petalHex, 0.55);
  }
}

// Colour-spill: on the approach to each stop threshold, a light scattering of
// buds blooms in the exact colours that stop will offer — a promise, not a
// wall of flowers. The beacons (light shafts) are the primary cue.
function addStopSpill(t) {
  const mix32 = (x) => {
    x |= 0;
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
    return (x ^ (x >>> 16)) >>> 0;
  };
  const extra = [];
  for (let i = 0; i < TOTAL_STOPS; i++) {
    const rng = mulberry32(mix32((meadowSeed ^ Math.imul(i + 1, 2654435761)) >>> 0));
    const offers = sampleChoices(meadowSeed, i).map((id) => flowerById(id));
    for (let k = 0; k < 8; k++) {
      const z = stopZs[i] + 4 + rng() * 14;
      const x = t.pointAt(z).x + (rng() - 0.5) * 6.5;
      const f = offers[Math.floor(rng() * offers.length)];
      const colHex = mixHex(f.petalHex, '#ffffff', 0.18); // pastel lift
      extra.push({
        x,
        y: HILLS.height(x, z) + 2.4,
        z: z + (rng() - 0.5) * 2.5,
        colorHex: parseInt(colHex.slice(1), 16),
        kind: Math.floor(rng() * FLOWER_KINDS.length),
        kindIndex: 0,
        cluster: -(i + 1), // sentinel: spill bud for stop i
      });
    }
  }
  t.buds.push(...extra);
  t.buds.sort((a, b) => b.z - a.z);
  const counts = Array.from({ length: FLOWER_KINDS.length }, () => 0);
  for (const b of t.buds) b.kindIndex = counts[b.kind]++;
}

// One soft beacon of light over each upcoming stop — visible from afar.
function refreshStopMarkers() {
  if (!render?.setStopMarkers || !stopZs) return;
  render.setStopMarkers(
    stopZs.map((z, i) => {
      const x = trail.pointAt(z).x;
      const mood = segmentMood(meadowSeed, i);
      return { x, y: HILLS.height(x, z), z, color: mood ? parseInt(mood.petalHex.slice(1), 16) : 0xfff1d6 };
    })
  );
}

let runSeedCounter = 42;

function beginRun(seed) {
  meadowSeed = seed >>> 0;
  trail = generateTrail({ seed: meadowSeed });
  stopZs = computeStopZs(trail);
  addStopSpill(trail);
  refreshStopMarkers();
  petal = { x: trail.pointAt(trail.zStart).x, z: trail.zStart, bank: 0, y: trail.pointAt(trail.zStart).y };
  meadowBuds = 0;
  meadowTotal = trail.buds.length;
  collectedSet = new Set();
  allBloomed = false;
  run = createRun(meadowSeed);
  basketPicks = [];
  closeStop();
  renderBasket();
  render?.setTrail(trail.buds, trail.mother);
  render?.resetTrail(); // new meadow = new ribbon
  saveProgress();
  updateHud();
  tintMeadowSegments();
}

// --- Debug jumps (?debug=stopN | ceremony) -------------------------------
const urlParams = new URLSearchParams(location.search);
const DEBUG_FLAG = urlParams.get('debug') || '';

function applyDebugJump() {
  const m = DEBUG_FLAG.match(/^stop([1-5])$/);
  if (m) {
    const target = parseInt(m[1], 10);
    for (let i = 0; i < target - 1; i++) {
      const offer = sampleChoices(run.seed, i);
      run = commitPick(reachStop(run), offer[0], offer);
    }
    petal.z = stopZs[target - 1] + 7; // cross the threshold within seconds
  } else if (DEBUG_FLAG === 'ceremony') {
    for (let i = 0; i < TOTAL_STOPS; i++) {
      const offer = sampleChoices(run.seed, i);
      run = commitPick(reachStop(run), offer[0], offer);
    }
    petal.z = trail.zEnd + 12; // already inside the ceremony trigger zone
  }
}

const FLOAT_ALT = 3.6; // cruise height above terrain when no flowers to catch
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
// Give the player real freedom: the pull is weak near the line and only
// grows slowly, so cruising off-center feels natural and holding wide
// requires only modest extra effort — no visible wall until quite far out.
const CENTER_K = 0.12;    // pull at origin (very gentle)
const CENTER_BIAS = 0.5;  // pull growth per unit of offset
const CENTER_CAP = 4.5;   // hard cap u/s
// Pull reaches the max-bank rate (~3.44 u/s) only around ~7 units out, so
// drifting to ~8-10 units is comfortable; beyond that it stiffens gradually
// but never locks the player in.

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
  // The world holds its breath while Ben chooses a flower, watches the
  // ceremony, or pauses; ambient petals keep swaying gently in the background.
  const frozen = paused || isStopOpen || run.phase === 'CEREMONY' || run.phase === 'DONE';
  if (!frozen) {
    const m = advance(petal, dt, { speed: CRUISE_SPEED * wind.speedFactor }, input.left, input.right);
    petal = { x: m.x + wind.swayVx * dt, z: m.z, y: petal.y + wind.bobY * dt, bank: m.bank };
    const targetY = flightTargetY();
    // Ease altitude toward the target for a smooth guided float.
    petal.y += (targetY - petal.y) * Math.min(1, dt * 2.2);
    clampAboveGround(); // safety net: never under the hills
    elasticCenter(dt); // weak rubber-band pull back to the path
    clampAboveGround(); // clamps again after lateral pulls
    windAssist(dt);
    clampAboveGround();
    checkCollection();
    if (run.phase === 'FLYING' && petal.z <= stopZs[Math.min(run.stopsDone, TOTAL_STOPS - 1)]) {
      openStop();
    } else if (run.phase === 'DRIFTING' && petal.z <= trail.zEnd + 14) {
      openCeremony();
    }
  }
  render?.setPetalSize(size);
  render?.setPetalGlow((size - 1) / (MAX_SIZE - 1));
  const windLean = Math.max(-0.3, Math.min(0.3, wind.swayVx * 0.3));
  // Wind effect level (0..1): steering is the big push, but the ambient wind
  // current always contributes a little so there is visible motion at rest.
  const ambWind = Math.abs(wind.swayVx);
  const windLevel = Math.min(
    1,
    (input.left || input.right ? 0.75 : 0) + ambWind * (frozen ? 0.15 : 0.5),
  );
  render?.frame(dt, { x: petal.x, y: petal.y, z: petal.z }, petal.bank + windLean, clock.elapsedTime, windLevel);
  if (render) render.renderer.render(render.scene, render.camera);
  updatePauseBtn();
  requestAnimationFrame(loop);
}

// On-screen Pause: visible during active play, hidden on menus/dialogs so
// the scan never has to pass it and it can't be tapped by accident.
const pauseBtn = document.getElementById('pauseBtn');
if (pauseBtn) pauseBtn.addEventListener('click', () => openPause());
function updatePauseBtn() {
  if (!pauseBtn) return;
  const show = started && !isTitleOpen && !paused && !isStopOpen && !ceremonyOpen();
  pauseBtn.hidden = !show;
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
    if (render) render.setPetalGeometry(geo);
    rec.used = true;
  } catch {
    /* model unavailable — procedural petal stays */
  }
}
loadModelAssets();

let started = false;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (paused) closePause();
    else closeConfirm();
  }
  // Pause menu: Space steps, Enter chooses.
  if (paused) {
    if (e.key === ' ') {
      focusPauseItem(pauseFocus + 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (!enterHeld) activatePauseItem(); // swallow repeats from the held key
      e.preventDefault();
    }
    return;
  }
  // Meadow stop chooser: Space steps the highlight, Enter commits.
  if (isStopOpen) {
    if (e.key === ' ') {
      focusChoice(stopFocus + 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      commitFocused(stopFocus);
      e.preventDefault();
    }
    return;
  }
  if (ceremonyOpen()) {
    // Interlude: Space skips the read / steps the choices, Enter replays or
    // chooses, Escape rests.
    if (interludePhase === 'reveal') {
      if (e.key === ' ') {
        hushSpeech(); // skip ahead to the send-off
        startMailing();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        holdScanForSpeech(() => startMailing()); // replay the haiku, then mail
        e.preventDefault();
      } else if (e.key === 'Escape') {
        toTitle();
        e.preventDefault();
      }
    } else if (interludePhase === 'choices') {
      if (e.key === ' ') {
        focusScanItem(scanFocus + 1);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        activateScanItem();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        toTitle();
        e.preventDefault();
      }
    }
    // during 'mailing' the keys wait politely for the send-off to finish
    return;
  }
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
	render?.setPetalSize(size);
	render?.setPetalCount(Math.min(8, 1 + Math.floor(totalBuds)));
	render?.setPetalGlow((size - 1) / (MAX_SIZE - 1));
	// Begin the ambient pad on this user gesture (autoplay policy).
	if (audio && ambientCheck && ambientCheck.checked) audio.startAmbient();
	render?.resetTrail(); // fresh ribbon from the starting path, no stale slots
	titleEl.style.display = 'none';
	// Album complete? Offer a quiet review instead of a new stage.
	if (stageIndex >= TOTAL_STAGES) {
		openInterlude(false);
		return;
	}
	flyNextStage();
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
  try {
    if (storage) resetBouquets(storage);
  } catch { /* gallery unavailable */ }
  // The nuclear option clears the session album too (page exit does anyway).
  stageIndex = 0;
  sessionCards = [];
  closeInterlude();
  runSeedCounter = 42;
  beginRun(42);
  started = false;
  isTitleOpen = true;
  titleEl.style.display = '';
  hushSpeech();
  closeConfirm();
  updateHud();
}

btnStart.addEventListener('click', startGame);
btnReset.addEventListener('click', () => (started ? openConfirm() : openConfirm()));
btnCancelReset.addEventListener('click', closeConfirm);
btnDoReset.addEventListener('click', doReset);

// Start on load is not automatic; the title screen waits for the player.
loadProgress();
// --- Live sync with the hub's shared managers -----------------------------
// If the player changes scan cadence or voice from the hub (or another game
// in another tab), Bloom picks it up immediately and re-arms whatever
// dialog timer is currently running.
function bindSharedManagers() {
  const sm = narbeScan();
  const vm = narbeVoice();
  if (sm) {
    sm.subscribe(() => {
      renderPauseItems();
      if (isStopOpen && stopTimer) {
        // Re-arm at the new cadence without re-speaking the current choice.
        clearInterval(stopTimer);
        stopTimer = armDialogTimer(() => focusChoice(stopFocus + 1));
      } else if (paused && pausePage === 'settings') {
        armPauseScan();
      } else if (ceremonyOpen() && interludePhase === 'choices') {
        armInterludeTimer();
      }
    });
  }
  if (vm) {
    vm.onSettingsChange((s) => {
      ttsOn = !!s.ttsEnabled;
      if (ttsCheck) ttsCheck.checked = ttsOn;
      try { storage.setItem(TTS_KEY, ttsOn ? '1' : '0'); } catch { /* no storage */ }
      renderPauseItems();
    });
  }
}
bindSharedManagers();
