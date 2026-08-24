import * as THREE from 'three';
import { initRender, resize, MEADOW_THEMES } from './render.js?v=23';
import { generateTrail, CRUISE_SPEED, FLOWER_VARIANTS, variantForShape } from './trail.js?v=6';
import { advance } from './steer.js';
import { collectBud, tintFor, stepSize } from './growth.js';
import { sampleChoices, flowerById, bouquetTitle, segmentMood, MEADOW_POOLS, speciesScale } from './flowers.js?v=5';
import { TOTAL_STOPS, TOTAL_STAGES, createRun, reachStop, commitPick, beginCeremony, finishCeremony } from './run.js';
import { loadBouquets, addBouquet, resetBouquets } from './gallery.js';
import { composePostcard } from './poem.js?v=3';
import { basketSvg, bloomInBasketSvg, bouquetSvg, stampSvg, flowerCardSvg } from './art.js?v=2';
import { mulberry32 } from './rand.js';
import { noteFor } from './notes.js';
import { initAudio } from './audio.js?v=1';
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
// Space burst: an optional breath of speed. Never required — the wind carries
// you at its own pace unless you ask for a little more sky.
let boostHeld = false;
let boostLevel = 0;

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

// Controls are deliberately minimal: Space and Enter are the only keys the
// game ever asks for. The whole screen is also the button (tap the left or
// right half to steer) for touch users. No Arrow/WASD keys, ever.
//
// One wind command only: holding Space rides a burst of wind (speed + a soft
// whoosh + a surge of trailing bubbles). Enter is never a second speed key —
// in flight it does nothing on a tap and opens Pause on a long press.
let gustHoldTimer = null;

window.addEventListener('keydown', (e) => {
	// While the title screen is up, Space/Enter belong to Start.
	if (isTitleOpen || paused) return;
	// While a meadow stop or ceremony is open, keys belong to those dialogs.
	if (isStopOpen || ceremonyOpen() || resting) return;
	// Holding Space rides a gentle burst of wind — the one speed-up in the
	// game, flight only, never needed. The whoosh acknowledges the command.
	if (e.key === ' ' && started && run.phase === 'FLYING') {
		if (!e.repeat) {
			boostHeld = true;
			audio?.whoosh?.();
		}
		e.preventDefault();
	}
	// Enter: a long press opens Pause (Escape and the ⏸ button do too).
	if (e.key === 'Enter' && started && (run.phase === 'FLYING' || run.phase === 'DRIFTING')) {
		if (!e.repeat) {
			clearTimeout(gustHoldTimer);
			gustHoldTimer = setTimeout(() => {
				if (!paused && !isStopOpen && !ceremonyOpen()) openPause();
			}, 700);
		}
		e.preventDefault();
	}
}, true);
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') boostHeld = false;
  if (e.key === 'Enter') {
    clearTimeout(gustHoldTimer);
    gustHoldTimer = null;
  }
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

// (On-screen steering buttons removed — the whole screen steers; see the
// note above. Overlays come in Task 8.)

// --- Game state --------------------------------------------------------
const WIND_THRESHOLD = 16; // lateral distance before wind assist kicks in
const WIND_FORCE = 1.2; // lateral nudge, world units/s
const COLLECT_RADIUS = 0.8; // base horizontal collect distance
const MAX_SIZE = 2.5;

let meadowSeed = 42;
let trail = generateTrail({ seed: meadowSeed, species: MEADOW_POOLS[0] });
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
    return { size, meadowBuds, meadowTotal, collected: collectedSet.size, blooms, seed: meadowSeed, allBloomed, openBuds: render?.budsOpened?.() ?? -1, theme: render?.currentThemeIndex?.() ?? -1, x: petal.x, z: petal.z, boost: boostLevel, gust: gust.active, paused, resting };
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
      budCounts: render?.budCounts?.() ?? [],
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
    // The hike's scene name lives top-left all day: where you are, always.
    const scene = MEADOW_THEMES[stageIndex % MEADOW_THEMES.length];
    hud.innerHTML =
      `<span class="hudTag">${scene.name} · ${Math.min(stageIndex + 1, TOTAL_STAGES)} of ${TOTAL_STAGES}</span>` +
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

// Stylized SVG for the chooser cards: true flower shape + growth-pattern
// size (clusters, spires, big singles) via art.js flowerCardSvg.
function flowerSvg(f, px = 80) {
  return flowerCardSvg(f, px);
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
  stopOffer = sampleChoices(run.seed, run.stopsDone, stagePool()); // slice for this stop
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
  focusChoice(0, true);
  // Greet the chooser: the first flower is read aloud the moment the module
  // opens, so a single Enter can pick it knowingly — no input required first.
  speak(flowerById(stopOffer[0]).tts);
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
  // Always name the chosen flower aloud — including the very first one,
  // picked without any scanning step before it.
  speak(`${f.name} added to your basket`);
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
// The hike: each meadow grows (and offers) only its elevation band's flowers.
function stagePool(i = stageIndex) {
  return MEADOW_POOLS[((i % MEADOW_POOLS.length) + MEADOW_POOLS.length) % MEADOW_POOLS.length];
}
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
  if (item.act === 'send') {
    cerPos.textContent = 'Send it fluttering to someone special?';
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
  // The postcard only leaves when Ben says so — sending is the gate to the
  // next meadow (or, after the last one, to the end of the day).
  scanItems = [
    { type: 'act', act: 'send' },
    { type: 'act', act: 'rest' },
  ];
}

// The haiku has been heard; now the two gentle choices take the stage.
function enterSendChoices() {
  if (!ceremonyOpen() || interludePhase !== 'reveal') return;
  clearTimeout(haikuGuard);
  interludePhase = 'choices';
  cerEl.classList.remove('pre-choices');
  buildScanItems();
  focusScanItem(0);
}

// Send-off: the postcard flies into the mailbox and is gone for good.
// Sending always carries Ben onward — or, after the final meadow, ends the
// day with every card on its way.
function startMailing() {
  if (!ceremonyOpen() || interludePhase !== 'choices') return;
  interludePhase = 'mailing';
  clearInterval(scanTimer);
  cerPos.textContent = 'Off it goes…';
  cerEl.classList.add('mail-time');
  postcardEl.classList.remove('postcard-in-r', 'postcard-in-l');
  void postcardEl.offsetWidth; // restart from a clean transform
  postcardEl.classList.add('mailing');
  clearTimeout(mailTimer);
  mailTimer = setTimeout(() => {
    if (!ceremonyOpen()) return;
    cerEl.classList.add('mailed'); // pops the little flag up
    audio?.chime?.(660); // gentle send-off chime
    speak('In the mail!');
    cerPos.textContent = 'Postcard mailed ✓';
    mailTimer = setTimeout(proceedAfterSend, 1800); // let the moment land
  }, 1500);
}

function proceedAfterSend() {
  if (!ceremonyOpen()) return;
  closeInterlude();
  if (stageIndex < TOTAL_STAGES) {
    flyNextStage();
  } else {
    toast('Every postcard is on its way.');
    speak('All your postcards are on their way. Rest well.');
    toTitle();
  }
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
  // wedged engines), the choices still arrive.
  rec.narrated = true;
  const spoke = holdScanForSpeech(() => enterSendChoices());
  clearTimeout(haikuGuard);
  if (spoke) haikuGuard = setTimeout(() => enterSendChoices(), 12000);
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
  closeRest();
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
  if (interludePhase !== 'choices') return; // choices unlock after the haiku
  const item = scanItems[scanFocus];
  if (!item) return;
  if (item.act === 'send') {
    startMailing(); // the send-off itself carries Ben onward
  } else {
    toTitle();
  }
}
if (btnFlyOn) btnFlyOn.addEventListener('click', () => { if (ceremonyOpen() && interludePhase === 'choices') activateScanItemAt('send'); });
if (btnRest) btnRest.addEventListener('click', () => { if (ceremonyOpen() && interludePhase === 'choices') activateScanItemAt('rest'); });
function activateScanItemAt(act) {
  if (act === 'send') startMailing();
  else openRest(); // "Rest here": a scenic rest point, not a menu
}

// --- Rest point -----------------------------------------------------------
// Resting keeps the whole world in view: the petal settles into a gentle
// hover, the grass sways on, and a translucent card shows everything you've
// gathered. You leave on your own terms (Continue the hike) or go home.
const restEl = document.getElementById('rest');
const restTitleEl = document.getElementById('restTitle');
const restSubEl = document.getElementById('restSub');
const restBasketEl = document.getElementById('restBasket');
const btnRestOn = document.getElementById('btnRestOn');
const btnRestMenu = document.getElementById('btnRestMenu');
let resting = false;
let restFocus = 0;
let restTimer = null;

function openRest() {
  if (resting) return;
  resting = true;
  closeInterlude();
  const theme = MEADOW_THEMES[((stageIndex % MEADOW_THEMES.length) + MEADOW_THEMES.length) % MEADOW_THEMES.length];
  restTitleEl.textContent = `Resting at ${theme.name}`;
  const n = basketPicks.length;
  restSubEl.textContent = n === 0
    ? 'The grass sways; the day waits for you.'
    : `${n} wildflower${n === 1 ? '' : 's'} so far. The day waits for you.`;
  restBasketEl.innerHTML = basketSvg(150, 132);
  const blooms = restBasketEl.querySelector('#basketBlooms');
  if (blooms) {
    blooms.innerHTML = '';
    basketPicks.forEach((id, i) =>
      blooms.insertAdjacentHTML('beforeend', bloomInBasketSvg(flowerById(id), i)));
  }
  hushSpeech();
  restEl.classList.add('show');
  focusRest(0, true);
  speak(`Rest well. ${n} wildflower${n === 1 ? '' : 's'} so far.`);
}

function focusRest(k, silent = false) {
  const btns = [btnRestOn, btnRestMenu];
  const n = btns.length;
  restFocus = ((k % n) + n) % n;
  btns.forEach((b, i) => b.classList.toggle('scanFocused', i === restFocus));
  clearInterval(restTimer);
  restTimer = armDialogTimer(() => focusRest(restFocus + 1));
  if (!silent) speak(btns[restFocus].textContent, 1);
}

function closeRest() {
  if (!resting) return;
  resting = false;
  clearInterval(restTimer);
  restEl.classList.remove('show');
  hushSpeech();
}

function continueHike() {
  closeRest();
  if (stageIndex < TOTAL_STAGES) {
    flyNextStage();
  } else {
    toast('You reached the summit. Rest well.');
    speak('Every wildflower is gathered. Rest well.');
    toTitle();
  }
}

function menuFromRest() {
  closeRest();
  toTitle();
}
if (btnRestOn) btnRestOn.addEventListener('click', continueHike);
if (btnRestMenu) btnRestMenu.addEventListener('click', menuFromRest);

// --- Pause menu (hold Return anywhere in gameplay) ------------------------
const pauseEl = document.getElementById('pause');
const pauseItemsEl = document.getElementById('pauseItems');
let paused = false;
let pausePage = 'main'; // 'main' | 'settings'
let pauseFocus = 0;
let pauseTimer = null;

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
  if (paused || !started || isTitleOpen || isStopOpen || ceremonyOpen() || resting) return;
  paused = true;
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
  // Embedded in the hub: hand focus back to its Back button (shared
  // convention, see developer-guide) instead of trying to close the tab.
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ action: 'focusBackButton' }, '*');
      closePause();
      toTitle();
      return;
    }
  } catch { /* cross-origin parent — fall through to standalone behavior */ }
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
  const card = composePostcard({ picks: run.picks, seed: run.seed, flowerById, stage: stageIndex });
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

// Colour-spill: on the approach to each stop threshold, a light scattering of
// buds blooms in the exact flowers that stop will offer — a promise, not a
// wall. Each spill bud is one of the offered species: same shape, size and
// colour as its chooser card, just a little smaller for the distance.
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
    const offers = sampleChoices(meadowSeed, i, stagePool()).map((id) => flowerById(id));
    for (let k = 0; k < 8; k++) {
      const z = stopZs[i] + 4 + rng() * 14;
      const x = t.pointAt(z).x + (rng() - 0.5) * 6.5;
      const f = offers[Math.floor(rng() * offers.length)];
extra.push({
          x,
          y: HILLS.height(x, z) + 2.4,
          z: z + (rng() - 0.5) * 2.5,
          colorHex: parseInt(f.petalHex.slice(1), 16),
          speciesId: f.id,
          scale: speciesScale(f.id) * 1.0,
          kind: variantForShape(f.shape),
          kindIndex: 0,
          cluster: -(i + 1), // sentinel: spill bud for stop i
        });
    }
  }
  t.buds.push(...extra);
  t.buds.sort((a, b) => b.z - a.z);
  const counts = Array.from({ length: FLOWER_VARIANTS.length }, () => 0);
  for (const b of t.buds) b.kindIndex = counts[b.kind]++;
}

// The stop itself must be somewhere to land: a small clump of the three
// offered flowers grows exactly at the trigger point, so when you pass over
// the threshold there really is a little patch of those flowers in the grass.
// Slightly larger than the drift of the meadow so it reads as the chooser.
function addStopFlowers(t) {
  const extra = [];
  for (let i = 0; i < TOTAL_STOPS; i++) {
    const offers = sampleChoices(meadowSeed, i, stagePool()).map((id) => flowerById(id));
    const cx = t.pointAt(stopZs[i]).x;
    const cz = stopZs[i] + 2.5; // right where the trigger waits
    offers.forEach((f, oi) => {
      for (let k = 0; k < 3; k++) {
        const a = oi * ((Math.PI * 2) / 3) + k * 0.75;
        const r = 1.5 + (k % 2) * 1.15;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r * 0.55;
        extra.push({
          x,
          y: HILLS.height(x, z) + 2.6,
          z,
          colorHex: parseInt(f.petalHex.slice(1), 16),
          speciesId: f.id,
          scale: speciesScale(f.id) * 2.0,
          kind: variantForShape(f.shape),
          kindIndex: 0,
          cluster: -(i + 1),
        });
      }
    });
  }
  t.buds.push(...extra);
  t.buds.sort((a, b) => b.z - a.z);
  const counts = Array.from({ length: FLOWER_VARIANTS.length }, () => 0);
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
  trail = generateTrail({ seed: meadowSeed, species: stagePool() });
  stopZs = computeStopZs(trail);
  addStopSpill(trail);
  addStopFlowers(trail);
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
  // The hike's light shifts with each meadow, and its name is announced —
  // dawn garden, morning valley, afternoon summit.
  render?.applyTheme?.(stageIndex);
  const theme = MEADOW_THEMES[stageIndex % MEADOW_THEMES.length];
  toast(theme.line);
  speak(theme.line);
}

// --- Debug jumps (?debug=stopN | ceremony) -------------------------------
const urlParams = new URLSearchParams(location.search);
const DEBUG_FLAG = urlParams.get('debug') || '';

function applyDebugJump() {
  const m = DEBUG_FLAG.match(/^stop([1-5])$/);
  if (m) {
    const target = parseInt(m[1], 10);
    for (let i = 0; i < target - 1; i++) {
      const offer = sampleChoices(run.seed, i, stagePool());
      run = commitPick(reachStop(run), offer[0], offer);
    }
    petal.z = stopZs[target - 1] + 7; // cross the threshold within seconds
  } else if (DEBUG_FLAG === 'ceremony') {
    for (let i = 0; i < TOTAL_STOPS; i++) {
      const offer = sampleChoices(run.seed, i, stagePool());
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

// --- Gust riding -----------------------------------------------------------
// Every so often a warm updraft slides under the petal and carries it in a
// slow arc — no input asked, nothing to do but ride it. Pure ambience.
const gust = { next: 7 + Math.random() * 8, active: false, t: 0, dur: 0, peak: 0 };

function gustUpdate(dt) {
  if (!gust.active) {
    gust.next -= dt;
    if (gust.next <= 0) {
      gust.active = true;
      gust.t = 0;
      gust.dur = 4.5 + Math.random() * 2.5;   // seconds aloft
      gust.peak = 5 + Math.random() * 3.5;    // how high the arc lifts
    }
    return 0;
  }
  gust.t += dt;
  if (gust.t >= gust.dur) {
    gust.active = false;
    gust.next = 9 + Math.random() * 9;
    return 0;
  }
  const k = gust.t / gust.dur;
  return Math.sin(Math.PI * k) ** 2 * gust.peak; // smooth rise, gentle settle
}

function loop() {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const wind = windAt(clock.elapsedTime, meadowSeed);
  // The world holds its breath while Ben chooses a flower, watches the
  // ceremony, or pauses; ambient petals keep swaying gently in the background.
  const frozen = paused || isStopOpen || resting || run.phase === 'CEREMONY' || run.phase === 'DONE';
  let gustLift = 0;
  if (!frozen) {
    gustLift = gustUpdate(dt);
    // Space burst: eased so engaging/release reads as wind strength, not a gear.
    // Space burst: eased so engaging/release reads as wind strength, not a
    // gear. It is the one wind command — the surge of trailing bubbles rides
    // with it so the burst is unmistakable.
    boostLevel += ((boostHeld ? 1 : 0) - boostLevel) * Math.min(1, dt * 3);
    render?.setBoost?.(boostLevel);
    render?.setGust?.(boostHeld ? 1 : 0);
    const gustFactor = gust.active ? 1.06 : 1;
    const m = advance(petal, dt, { speed: CRUISE_SPEED * wind.speedFactor * gustFactor * (1 + 0.5 * boostLevel) }, input.left, input.right);
    petal = { x: m.x + wind.swayVx * dt, z: m.z, y: petal.y + wind.bobY * dt, bank: m.bank };
    // The gust adds its lift to the altitude target, so the existing ease
    // turns it into one long breath of height instead of a jolt.
    const targetY = flightTargetY() + gustLift;
    // Ease altitude toward the target for a smooth guided float.
    petal.y += (targetY - petal.y) * Math.min(1, dt * (gust.active ? 1.4 : 2.2));
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
  // While resting the petal settles into a slow hover above the grass.
  if (resting) petal.y = flightTargetY() + 0.7 * Math.sin(clock.elapsedTime * 1.3);
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
    else if (started && !isStopOpen && !ceremonyOpen()) openPause();
    else closeConfirm();
  }
  // Rest point: Space steps between the two gentle choices, Enter picks,
  // Escape gets up and carries on.
  if (resting) {
    if (e.key === ' ') {
      focusRest(restFocus + 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (!e.repeat) (restFocus === 0 ? continueHike() : menuFromRest());
      e.preventDefault();
    } else if (e.key === 'Escape') {
      continueHike();
      e.preventDefault();
    }
    return;
  }
  // Pause menu: Space steps, Enter chooses.
  if (paused) {
    if (e.key === ' ') {
      focusPauseItem(pauseFocus + 1);
      e.preventDefault();
    } else if (e.key === 'Enter') {
      if (!e.repeat) activatePauseItem(); // ignore auto-repeats
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
        hushSpeech(); // skip ahead to the send / rest choices
        enterSendChoices();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        holdScanForSpeech(() => enterSendChoices()); // replay the haiku
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
