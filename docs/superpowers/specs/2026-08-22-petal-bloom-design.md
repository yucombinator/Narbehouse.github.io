# Petal Bloom — Design

Date: 2026-08-22
Status: approved (chat, 2026-08-22; control revised by user to two-button steering)

## Elevator pitch

A Flower-like drift game stripped to one loop: *you are a petal, always moving
forward at a preset speed; hold LEFT or RIGHT to bank; follow the glowing trail
of buds down the meadow; each bud collected grows you bigger; reaching the
mother bloom at the trail's end blooms a brand-new random meadow — endlessly.
No fail state, no timer, no keys beyond two steering inputs.*

## Core loop

1. The world is a dreamy pastel meadow-sky. A random 3D trail (a gently
   undulating spline) winds ahead of the player, dotted with glowing flower
   buds at regular spacing along it.
2. The player petal cruises forward at constant speed. Altitude is
   auto-followed: the petal gently magnets to the trail's height under it, so
   steering is a pure left/right pursuit problem — the only skill in the game.
3. Buds collect by proximity (generous radius, no aim precision). Each
   collection: soft *pop* ring, a chime, and a growth step.
4. A meadow ends when every planted bud on it has bloomed; the trail end then
   hosts a larger **mother bloom**. Touching it blooms the meadow: a new random
   trail regenerates, the player keeps their size and continues.
5. Nothing can fail: no lives, no timers, no out-of-bounds death. If the
   player drifts far from the trail, a faint wind-current assist banks them
   back toward the nearest uncollected bud.

## Control model (user-specified)

- **Always moving forward at a preset speed.** No throttle, no brakes.
- **Two buttons: LEFT and RIGHT.** Hold to bank in that direction; release to
  ease back to level. Holding both = straight (inputs cancel).
- Input surfaces, all equal:
  - On-screen: two large buttons bottom-left / bottom-right (mouse, touch).
  - Keyboard: ArrowLeft / ArrowRight, A / D, and Spacebar=LEFT, Return=RIGHT
    (two-switch accessible players).
  - Click/tap: left half of the canvas = LEFT, right half = RIGHT.
- No scanning, no menus-in-play, no pause requirement for release — the game is
  a continuous drift; releasing both buttons returns to straight and safe.

The game is deliberately *not* a bennyshub switch game (it does not use the
hub's scan manager, and its input is continuous hold-to-steer), so it ships at
site level as `flowerpetal/`, outside the hub's games list.

## Movement details

- Cruise speed: fixed preset (≈6 world units/s), tuned once. No setting.
- Banking: hold sets a target bank angle (max ≈ ±35°), applied with a
  smoothed rate (~3 rad/s toward target, ~1.8 rad/s back to level). Banked
  petal visibly tilts into the turn.
- Lateral turn radius follows `speed * tan(bank)`; trail curvature is matched
  to this so a max-bank turn can always hold the trail even on its tightest
  bend. **Invariant: the hardest valid trail curve must be holdable at max
  bank.** Trail generation clamps curvature accordingly.
- Altitude groove: petal Y eases toward spline Y at the player's Z with a
  gentle spring (fast enough to feel grounded, slow enough to read as
  floating); Z advances along the trail's forward axis.
- Wind-current assist: when the perpendicular distance to the nearest
  uncollected bud exceeds a threshold, an invisible lateral force nudges the
  petal back toward the trail (plus a faint shimmering particle streak
  showing the way). Strong enough to prevent getting permanently lost, weak
  enough that steering still feels like the player's job.

## Trail generation (pure logic, unit-tested)

- `generateTrail(seed, length)` returns a spline: forward axis `z`, lateral
  `x(z)` = sum of 2–3 sine waves with random amplitude/frequency/phase plus
  per-z jitter, altitude `y(z)` = similarly gentle. Clamp the resulting
  curvature to the max-bank invariant above.
- Buds: `BUD_SPACING` (±7 z units) placed at spline positions, alternate
  sides/offsets with slight perpendicular offset (±1.2) so the path reads as a
  trail rather than a rail; each bud gets a random pastel color from a curated
  palette. Seeds: `seededRandom`.
- Mother bloom: placed at the spline end, larger, brighter, slow pulsing.
- **Invariants tested:** all buds lie within a bounded corridor around the
  spline; spacing within tolerance; never two buds closer than min distance;
  spline curvature everywhere ≤ max-bank-holdable curvature; no NaN anywhere;
  two meadows from the same seed are identical (determinism); different seeds
  differ (sanity).

## Growth model (pure logic, unit-tested)

- State: `size` (1.0 start), per-meadow `budsCollected`, `bloomsComplete`.
- Each bud: `size += (MAX_SIZE - size) * GROWTH_K` with `MAX_SIZE = 2.5`,
  `GROWTH_K = 0.09` → strongly diminishing: early buds are visible steps
  (+9% of remaining), late buds are tiny. **Invariant: monotonic nondecreasing,
  bounded above by MAX_SIZE + epsilon, never ≤ 0.**
- Tint shifts along a preset gradient as size grows (render-side lerp).
- Persistence: localStorage `petalBloom.save` = `{ size, totalBuds, blooms }`,
  written on each collection and bloom (auto-save). Resume restores size/scale
  and counters; trails are always fresh.

## World / rendering

- three.js r160 pinned, bundled-free: `importmap` → unpkg `three.module.js`
  and `three/addons/`. No build step; folder is static-servable.
- Sky: large gradient dome (shader or vertex colors), soft fog matching
  palette, distant instanced hills/blobs, drifting cloud puffs (cheap
  billboards or instanced spheres).
- Petal: rounded petal shape (extruded/parametric), emissive core, subtle
  bobbing + banking tilt; camera trails behind and above on a smooth lerp,
  FOV 60, DPR capped at 1.5.
- Buds and mother bloom: `THREE.InstancedMesh` (one draw call), emissive
  material, gentle pulsing scale per instance; collection pops a ring sprite +
  particle burst.
- No shadows, no postprocessing, no heavy textures. Performance budget:
  mobile-60fps target; complexity stays near-constant regardless of meadow.

## Audio

- WebAudio (this is a standalone web game; the bennyshub SafeAudio/Electron
  constraint does not apply here): synthesized soft chime per bud (pentatonic
  pitch rising slowly as size grows), deeper bloom chord on meadow complete,
  faint wind pad loop at low volume. No audio assets — all synthesized.
- Mute toggle on the title card only (keyboard `M` + on-screen checkbox). TTS
  not required (outside hub); title/help text rendered on-screen in large,
  high-contrast type.

## UI

- **Title card** (first load / after "New Petal" reset): game title, two-line
  how-to ("Hold LEFT or RIGHT to turn. Follow the trail. Grow big."), Start
  button (Return/Space or click), Reset progress (two-step confirm).
- **In-game HUD**: top-left meadow progress (`buds / total`), top-right size
  ring. Bottom corners: the two big steering buttons (semi-transparent,
  scaled on press). Help text replays on hold-to-steer only if asked — keep
  the screen clean.
- No pause menu needed mid-flight could not be operated — releasing both
  buttons is inherently safe; `Esc`/`P` pauses (camera drift continues,
  steering disabled) with Resume/Restart meadow/Main menu, all clickable.

## Architecture / files

```
flowerpetal/
  index.html                 # importmap, canvas, HUD, buttons, boots src/main.js
  src/
    main.js                  # scene, render loop, input wiring, audio triggers (thin glue)
    trail.js                 # generateTrail, seededRandom, curvature clamp (pure)
    growth.js                # size stepping, tint gradient, meadow state (pure)
    state.js                 # save/load localStorage, counters, meadow lifetime (pure)
    render.js                # meshes, instancing, camera, sky (three-dependent)
    audio.js                 # synthesized chimes/pad (WebAudio)
  test/
    trail.test.js            # invariants above
    growth.test.js           # growth curve, meadow completion, save round-trip
    state.test.js            # save/load round-trip, corrupt input
```

Pure modules (`trail.js`, `growth.js`, `state.js`) never import three.js or
touch the DOM/WebAudio → run under `node --test` in Node ≥18. Render/audio/UI
are thin, verified by browser smoke test (see plan).

Persistence-only caveat: state.js's localStorage adapter is injected, so tests
use an in-memory store; the browser path passes `localStorage`.

## Out of scope (explicit)

- No enemy, no hazards, no scoring beyond growth, no levels/win state, no
  online features, no mobile-app packaging, no bennyshub integration, no
  settings beyond the mute toggle.
- The petal does not shrink, ever. (Growth is unidirectional — the game is a
  comfort loop, not a challenge loop.)

## Acceptance criteria

1. Two buttons (on-screen + keyboard Space/Return + arrows + A/D) fully play
   the game from title to endless meadows; no other control required.
2. Constant forward speed; banking feels smooth; hardest generated trail curve
   is holdable at max bank.
3. Every planted bud is collectible by mere path-following *within the
   wind-assist's guarantee* (drift far → current pulls back; no hard loss).
4. Growth is monotonic and capped; progress survives reload (localStorage).
5. Meadow completion blooms a fresh random meadow; size persists across it.
6. All pure-logic invariants pass `node --test`.
7. Browser smoke test on the local static server: title → start → steer →
   collect → bloom → next meadow, at a stable framerate, console clean.