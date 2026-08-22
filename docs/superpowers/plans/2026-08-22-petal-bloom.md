# Petal Bloom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Flower-like drift game — always-cruising petal steered by two buttons (LEFT/RIGHT), growing by collecting buds along randomly generated 3D trails, endlessly regenerating meadows, in `~/dev/Narbehouse.github.io/flowerpetal/` (static, no build step).

**Architecture:** Pure, unit-tested logic modules (`trail.js`, `growth.js`, `state.js`, `steer.js`, `meadow.js`, `notes.js` — no three.js/DOM/WebAudio imports) run under `node --test`; thin render/input/audio glue (`main.js`, `render.js`, `audio.js`, `index.html`) is exercised via browser smoke tests on the local static server (port 8000). Growth is unidirectional and capped; there is no fail state.

**Tech Stack:** three.js r160 (CDN via importmap), vanilla ES modules, Node ≥ 18 `node --test` (v24.7.0 present).

**Spec:** `docs/superpowers/specs/2026-08-22-petal-bloom-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Repo: `~/dev/Narbehouse.github.io`, branch `petal-bloom` (never `main`).
- Constant cruise speed `CRUISE_SPEED = 6` u/s; NEVER a throttle.
- Only two steering inputs: LEFT, RIGHT. Hold to bank, release to straighten. Both held = straight.
- No fail state, no timer, no shrinking. `MAX_SIZE = 2.5`, `GROWTH_K = 0.09`.
- Pure modules import nothing outside `node:` — zero three.js/DOM/WebAudio.
- Randomness: `mulberry32(seed)` only; same seed ⇒ identical meadow.
- Curvature invariant: everywhere `|x''(z)| ≤ MAX_CURVATURE = 0.09`, which is ≤ `holdableCurvature()` with ≥ 2× margin (`G_EFF = 9.8`, `MAX_BANK_DEG = 35`).
- All colors from the pastel palette in `trail.js`; HUD text large, high contrast; no audio assets (synthesized only).
- three.js pinned `0.160.0`; no other dependencies; no build step.

---

### Task 1: `trail.js` — random trail generation (pure)

**Files:**
- Create: `flowerpetal/src/trail.js`
- Test: `flowerpetal/test/trail.test.js`

**Interfaces:**
- Consumes: nothing (first task).
- Produces:
  - `mulberry32(seed: number) -> () => number` (PRNG in [0,1))
  - `generateTrail({ seed: number, length?: number, budSpacing?: number }) -> Trail`
  - `Trail = { zStart: number, zEnd: number, buds: Array<{x,y,z,colorHex}>, mother: {x,y,z}, pointAt(z) -> {x,y}, curvatureBound: number }`
  - Constants: `CRUISE_SPEED`, `MAX_BANK_DEG`, `G_EFF`, `MAX_CURVATURE`, `BUD_SPACING`, `LATERAL_OFFSET`, `ALT_AMPLITUDE`, `holdableCurvature()`, `PALETTE` (array of pastel hex ints).

- [ ] **Step 1: Write the failing test** — `flowerpetal/test/trail.test.js` (8 tests: mulberry32 deterministic/in-range; same-seed identical / diff-seed differs; bud spacing sorted/even/count; corridor invariant; no NaN; curvature bound invariant across 5 seeds; palette membership).
- [ ] **Step 2: Run test to verify it fails** — `node --test flowerpetal/test/trail.test.js` → FAIL `ERR_MODULE_NOT_FOUND`.
- [ ] **Step 3: Implement `flowerpetal/src/trail.js`** — mulberry32; lateral `x(z)` as 2–3 summed sines with amplitudes scaled so worst-case `Σ(aᵢfᵢ²) ≤ MAX_CURVATURE`; altitude `y(z) = 6 + 2 gentle sines`; buds every `BUD_SPACING` with alternating `±LATERAL_OFFSET`; mother at `zEnd`; `curvatureBound` analytic; `pointAt(z)`.
- [ ] **Step 4: Run test to verify it passes** — 8 PASS.
- [ ] **Step 5: Commit** — `feat(petal-bloom): random trail generation with curvature invariant`

### Task 2: `growth.js` — growth math (pure)

**Files:**
- Create: `flowerpetal/src/growth.js`
- Test: `flowerpetal/test/growth.test.js`

**Interfaces:**
- Produces: `MAX_SIZE = 2.5`, `GROWTH_K = 0.09`, `stepSize(size) -> number`, `tintFor(progress01) -> hex`, `collectBud({size, meadowBuds, meadowTotal}) -> {size, meadowBuds, meadowTotal, doesBloom}`.

- [ ] **Step 1: Write failing test** — monotonic/capped/convergent `stepSize`; first-step biggest, diminishing; `tintFor` clamps+lerps; `collectBud` advances once per bud, bloom flag at `meadowBuds === meadowTotal`, no over-collect.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — `stepSize = size + (MAX_SIZE-size)*GROWTH_K`; `TINTS = [[0,0xffe3f0],[0.5,0xcde7ff],[1,0xffffff]]` lerp; `collectBud` guards `meadowBuds >= meadowTotal`.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `feat(petal-bloom): diminishing growth curve and meadow collection state`

### Task 3: `state.js` — persistence (pure, injected storage)

**Files:**
- Create: `flowerpetal/src/state.js`
- Test: `flowerpetal/test/state.test.js`

**Interfaces:**
- Consumes: `MAX_SIZE` from `growth.js`.
- Produces: `KEY='petalBloom.save'`; `createMemoryStore()`; `loadSave(storage) -> save|null`; `writeSave(storage, save)`; `resetSave(storage)`.

- [ ] **Step 1: Write failing test** — store semantics; round-trip; null on absent/corrupt; clamp out-of-range (`size>MAX_SIZE→MAX_SIZE`, negative→0); reset clears.
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement** — `clean()` clamps each field; `JSON.parse` in try/catch.
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Commit** — `feat(petal-bloom): save/load progress with injected storage`

### Task 4: `index.html` + boot + first renderable scene

**Files:**
- Create: `flowerpetal/index.html` (importmap → `three@0.160.0`, `#game` div, minimal CSS)
- Create: `flowerpetal/src/render.js` — `initRender(canvas) -> {scene, camera, renderer, petal, setPetalSize(s), setPetalTint(hex), frame(dt, pos{x,y}, bank)}`; sky gradient dome, ground disc, petal group, lights; `resize(api)`.
- Create: `flowerpetal/src/main.js` — boot canvas, `initRender`, resize handler, demo cruise along trail centerline (placeholder for Task 5).

- [ ] **Step 1: Write `index.html`**
- [ ] **Step 2: Write `render.js`**
- [ ] **Step 3: Write `main.js` bootstrap**
- [ ] **Step 4: Browser verify** — http://127.0.0.1:8000/flowerpetal/ shows pink petal over pastel meadow; console clean; screenshot.
- [ ] **Step 5: Commit** — `feat(petal-bloom): bootable scene with sky, meadow, petal, camera rig`

### Task 5: Two-button input + movement

**Files:**
- Create: `flowerpetal/src/steer.js` (pure) + `flowerpetal/test/steer.test.js`
- Modify: `flowerpetal/src/main.js` (real input + cruise/bank + loop)

**Interfaces:**
- Consumes: `CRUISE_SPEED`, `MAX_BANK_DEG`; `render.frame`.
- Produces: `MAX_BANK_RAD`; `advance({x,z,bank}, dt, {speed, maxBankRad, bankRate=3, levelRate=1.8}, left, right) -> {x,z,bank}` — bank eases to ±max, release eases to 0, both-held=0; `x += speed*sin(bank)*dt`, `z += speed*cos(bank)*dt`.
- Input: on-screen `#btnL/#btnR` (pointerdown/up/cancel/leave), keyboard ArrowLeft/A/Space=left, ArrowRight/D/Enter=right, canvas halves on click.

- [ ] **Step 1: Write failing steer tests** (banks left/right, straightens on release, both=straight, clamp, constant speed regardless of bank)
- [ ] **Step 2: Run → FAIL**
- [ ] **Step 3: Implement `steer.js`**
- [ ] **Step 4: Run → PASS**
- [ ] **Step 5: Rewrite `main.js`** — input wiring + rAF loop with dt clamp 1/20s
- [ ] **Step 6: Browser smoke** — hold right then left; petal banks and moves laterally; console clean
- [ ] **Step 7: Commit** — `feat(petal-bloom): two-button steering and constant cruise`

### Task 6: Buds instancing, collection, growth, audio

**Files:**
- Modify: `flowerpetal/src/render.js` (instanced buds + mother bloom + pop ring)
- Modify: `flowerpetal/src/main.js` (collection detection, HUD)
- Create: `flowerpetal/src/notes.js` (pure) + test; `flowerpetal/src/audio.js`

**Interfaces:**
- Produces: `render.setTrail(buds, mother)`; `render.collectPop(index)`; `render.setBudCollected(i)`; `notes.js: PENTATONIC, noteFor(stepIndex) -> Hz`; `audio.js: initAudio() -> {chime(freq), bloomChord(), muted}`; HUD `#hud` buds/total + size ring.
- Collection: horizontal distance < `0.8 + size*0.5` → `collectBud`, `setPetalSize`, `setPetalTint(tintFor((size-1)/(MAX_SIZE-1)))`, chime at `noteFor(totalCollected)`, HUD, autosave.

- [ ] **Step 1: TDD `notes.js`** (first=220Hz, monotonic, capped)
- [ ] **Step 2: render.setTrail/collectPop + audio.js** (InstancedMesh one draw call; chime = osc + gain envelope; bloom = stacked chord)
- [ ] **Step 3: Wire collection in main.js**
- [ ] **Step 4: Browser smoke** — steer into buds: bud disappears, petal grows, counter increments, audio running
- [ ] **Step 5: Commit** — `feat(petal-bloom): collectible bud trail with growth and chimes`

### Task 7: Meadow completion + regeneration + wind assist

**Files:**
- Modify: `flowerpetal/src/main.js`
- Create: `flowerpetal/src/meadow.js` (pure) + test

**Interfaces:**
- Produces: `meadow.js: nextMeadow({seed, blooms, size, totalBuds, meadowBuds}) -> {seed+1, blooms+1, size, totalBuds+meadowBuds}`.
- Wind assist: `dx = nearestBud.x - petal.x`; if `|dx| > WIND_THRESHOLD=16` add `sign(dx)*1.2*dt` to x; faint streak particles.

- [ ] **Step 1: TDD `meadow.js`**
- [ ] **Step 2: Wire regeneration** — on `doesBloom` + proximity to mother: regenerate `seed+1`, reset meadow counters, save, sky pulse
- [ ] **Step 3: Browser verify** a meadow completes → fresh trail spawns (dev `?auto` flag teleports near mother, removed before final commit)
- [ ] **Step 4: Commit** — `feat(petal-bloom): endless meadow regeneration with wind assist`

### Task 8: Title card, HUD polish, reset (two-step), persistence wiring

**Files:**
- Modify: `flowerpetal/index.html` (title overlay, HUD, big buttons)
- Modify: `flowerpetal/src/main.js` (start/reset flows, autosave on collect+bloom)

**Interfaces:**
- Consumes: `state.js` (Task 3).
- Produces: title card (Start, Reset with two-step confirm); HUD buds/total + size ring; persistence restored on Start; keyboardable (Space/Return/Tab).

- [ ] **Step 1: Build overlay + flows**
- [ ] **Step 2: Browser smoke** — title→start (size from save)→collect→reload→size restored; two-step reset wipes
- [ ] **Step 3: Commit** — `feat(petal-bloom): title card, HUD, two-step reset, persistence`

### Task 9: Polish + full acceptance pass

**Files:**
- Modify: `flowerpetal/src/render.js` (cloud puffs, bud pulse, pop particles, mother glow)
- Modify: `flowerpetal/src/main.js` (camera feel, wind streaks)
- Create: `flowerpetal/README.md`

- [ ] **Step 1: Visual polish** per spec
- [ ] **Step 2: Full unit suite** — `node --test flowerpetal/test/` all green
- [ ] **Step 3: Acceptance smoke in browser** — title→start→steer→collect→grow→bloom→next meadow→reload persists→two-step reset; console clean
- [ ] **Step 4: README**
- [ ] **Step 5: Commit; report completion**

---

## Self-Review Notes

- Spec coverage: trail gen + growth + persistence + controls + regen = Tasks 1–3, 5, 7; rendering/audio/UI = 4, 6, 8, 9; acceptance criteria map to Task 9 Step 3. Wind assist in Task 7. No spec requirement left unassigned.
- Type consistency: `advance(state, dt, cfg, left, right)` fixed across steer tests and main.js; `collectBud` return shape `{size, meadowBuds, meadowTotal, doesBloom}` consistent in Tasks 2/6/7; `Trail` shape from Task 1 used verbatim in Tasks 4/6/7.