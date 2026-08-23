# Petal Bloom — Handoff & Implementation Notes

**Written:** 2026-08-22 · **Branch:** `petal-bloom` (13 commits + uncommitted fix batch) · **Status:** playable, tests green, one uncommitted batch of fixes in the working tree

This file is the working agreement for anyone (human or agent) who continues building in this game. Read it before touching `flowerpetal/`. It records what exists, why it is shaped the way it is, and the accessibility constraints that are load-bearing — not decoration.

---

## 1. What the game is

A Flower-like ([Flower, thegame](https://en.wikipedia.org/wiki/Flower_(video_game))) drift game stripped to one loop:

> You are a flower petal **always moving forward at a preset speed**. Hold **LEFT** or **RIGHT** to bank and steer. Follow a glowing trail of flower buds; every bud you float through is collected, pops, and **grows you bigger** (diminishing curve, hard cap). At the trail's end a **mother bloom** waits; touching it regenerates a brand-new random meadow of buds. Endless. No fail state. You never shrink.

Served at: **`http://127.0.0.1:8000/flowerpetal/`** (local static server `narbe-site` on port 8000; repo root is `/Users/yucombinator/dev/Narbehouse.github.io`).

## 2. How to run / verify

- Serve the repo root: `python3 -m http.server 8000` (from `~/dev/Narbehouse.github.io`).
- Play: `http://127.0.0.1:8000/flowerpetal/`
- Unit tests (pure logic only — no three.js/DOM/WebAudio):

  ```bash
  cd ~/dev/Narbehouse.github.io
  node --test 'flowerpetal/test/*.test.js'   # 33 tests, all green
  ```

- No build step, no npm, no bundler. three.js r160 loads from unpkg via the importmap in `index.html` (needs network on first load).

## 3. File map

```
flowerpetal/
  index.html           # page shell: canvas, HUD (buds/total + size ring), title card,
                       #   two-step reset confirm, importmap for three.js
  README.md            # user-facing quick start + controls (keep in sync)
  src/
    main.js            # glue: boot renderer, input wiring, game loop, collection,
                       #   wind assist, meadow regeneration, title/reset flows, autosave
    render.js          # three.js scene: gradient sky dome, ground, 5-petal flower
                       #   player + instanced buds + mother bloom, pop rings, clouds,
                       #   camera rig (trails behind, looks ahead), flower geometry factory
    trail.js           # PURE: seeded random trail generation + curvature invariant
    steer.js           # PURE: hold-to-bank steering, constant cruise speed
    growth.js          # PURE: diminishing size curve, tint gradient, collectBud state
    meadow.js          # PURE: meadow-lifecycle transition (seed+1, blooms+1)
    state.js           # PURE: localStorage save/load with injected storage (memory-store in tests)
    notes.js           # PURE: pentatonic pitch ladder for collection chimes
    audio.js           # synthesized SFX + generative ambient pad (WebAudio; no assets)
  test/                # node --test suites for every PURE module above
```

**Rule:** the six `PURE` modules (trail, steer, growth, meadow, state, notes) must never import three.js, touch the DOM, or touch WebAudio. They are what the unit tests cover and what the next agent can safely refactor. Everything visual/input/audio lives in `render.js`, `audio.js`, `main.js`.

## 4. Core mechanics & constants (current, verified)

| Thing | Value / behavior |
| --- | --- |
| Cruise speed | `CRUISE_SPEED = 6` world units/s, **never variable** |
| Steering | Hold LEFT/RIGHT → bank eases to `MAX_BANK_DEG = 35°` at `bankRate = 3 rad/s`; release eases back at `levelRate = 1.8 rad/s`; both held = straight |
| Forward direction | **−z** (three.js convention). Trail runs `z = 40` → `z = 40 − 400`; camera sits at `petal.z + 11`, looks at `petal.z − 30` |
| Left = −x | With the camera at larger z looking toward −z, +x is screen-right. RIGHT button → +x bank → turns screen-right. (This was recently flipped; see §7) |
| Altitude | Auto-grooved: petal gets `y` from the trail spline under it. Steering is purely lateral — there is no aiming |
| Buds | `BUD_SPACING = 7`, alternating `±LATERAL_OFFSET = 1.2` off the spline, pastel palette (6 colors), 40–70 per meadow |
| Collection radius | `0.8 + size * 0.5` — grows with you; generous, proximity-only |
| Growth | `stepSize(s) = s + (MAX_SIZE − s) * GROWTH_K`, `MAX_SIZE = 2.5`, `GROWTH_K = 0.09`; monotonic, capped, diminishing |
| Tint | Pale pink → pale blue → white across `(size−1)/(MAX_SIZE−1)` |
| Wind assist | If nearest uncollected bud's |dx| > `WIND_THRESHOLD = 16`, gentle lateral nudge `1.2 u/s` toward it + a pull-you-back guarantee. **No hard loss exists** |
| Meadow end | Collect all buds → `allBloomed` → touch mother (within `BLOOM_REACH = 5`) → `seed+1`, new trail, size persists |
| Save | `localStorage['petalBloom.save'] = {size,totalBuds,blooms}` autosaved on every collect + every bloom; two-step reset (`btnReset` → confirm → `btnDoReset`) |
| Audio | Pentatonic ladder `noteFor(step)`, chime per bud; Cmaj chord on bloom; **generative ambient pad** (Dm9→Cadd9→Am9→Fmaj7 drone + pentatonic sparkle bells + LFO breathing); all synthesized, zero assets/free-to-use; Start begins it (user gesture), `M`/title-checkbox toggles, and pref in `localStorage['petalBloom.ambient']` |

## 5. Architectural invariants (do not break casually)

1. **Curvature budget.** Trail lateral curve is `x(z) = Σ aᵢ·sin(fᵢz + φᵢ)` with amplitudes scaled so worst-case `Σ aᵢfᵢ² ≤ MAX_CURVATURE = 0.09`, which is ≤ `holdableCurvature()` with ≥2× margin (`g·tan(35°)/v²`). **Any trail the generator emits must be followable at full bank** — raising speed or max-bank needs re-tuning both.
2. **Determinism.** Randomness is `mulberry32(seed)` only. Same seed ⇒ identical meadow. `seed` increments by 1 per bloom.
3. **No fail state, no timer, no shrinking.** The game is a comfort loop, deliberately. Don't add lives, timers, collisions-with-consequences, or damage.
4. **Two buttons only** (plus Start/Reset on the title card). No third axis, no throttle, no menus-in-play. See §6.
5. **Pickup ≠ precision.** Collection is proximity and the trail is always turnable; a player who keeps the trail roughly ahead collects everything given flight time.

## 6. Accessibility philosophy & limitations (the why)

This game lives **outside** bennyshub's games list on purpose, but it was built against the same NARBE House accessibility guide (`bennyshub/ACCESSIBILITY.md` / `developer-guide.html`). The guide's core line: *"remove the precision and reaction demand from a genre — not the genre itself."*

What we took from it:

- **No reflex/precision demands** — nothing here requires fast reactions or small targets. Movement is "pursuit along a groove": you steer laterally at constant speed; altitude and speed are automatic. This is the guide's **oscillate-and-stop / armed-direction** family applied to flight.
- **Fail states come with alternatives** — here there simply is no fail state. Wind assist replaces "falling off" — you can always come back.
- **One-switch floor respected in spirit** — with a single key mapped to LEFT+RIGHT alternating (e.g. a switch that banks left on press and right on hold-release, the guide's *armed direction* pattern), the whole game is playable with one input. The hub's `NarbeScanManager` interval/scan conventions don't apply because this game is continuous-time, not selection-based — a deliberate philosophical choice.

What the game is **not** (documented limitations — known and accepted):

- **It is not a scan-and-select game.** The hub's standard is: highlight moves through a finite list, Return commits, everything reachable by scan. This game's core interaction is *hold to steer* — continuous, temporal control. That is real and valuable for players with gross-motor control of a held switch, but it **excludes players who cannot sustain a hold or who need discrete selection**.
- **No scannable alternative mode exists yet** (e.g., an auto-left/right oscillating "aimer" + press-to-commit, like P3GL's Auto Scan mode). This is the single biggest philosophical gap. A future agent could add an **oscillate-and-stop** mode (aimer sweeps, press banks, auto straighten) and switch it via a setting — that would make it one-switch *press-only* playable.
- **No TTS, no scan-speed setting, no hub managers.** If this ever moves *into* bennyshub, it must adopt `NarbeVoiceManager` + `NarbeScanManager` and re-surface its controls as discrete scan steps.
- **Hold feedback is minimal.** The guide wants visible/audible hold progress (filling ring). The bank tilt is visible, but there's no "hold is building" cue yet.
- **Growth is the only reward axis** — there is no economy, no score, no fail. We judged that right for this game's brief ("extremely simplified, comfort loop"); it is not a universal template.

The tension, stated plainly: *pursuit-and-hold games are accessible to a different population than scanning-select games.* This one deliberately serves the former; converting it to the latter is the available future work, not a bug.

## 7. Recent fixes (THIS IS THE CURRENT WORKING TREE — not yet committed)

The following are **modified but uncommitted** in `flowerpetal/` right now (`git status` shows them). They fix the three complaints: *"movement broken / not moving forward", "controls felt inverted", "petal small", "don't look like flowers"*.

1. **Forward motion.** `render.js` previously pinned the petal at `z=0` and the camera never advanced; the world was frozen and the sim collected buds "telepathically". Now: `frame(dt, {x,y,z}, …)` places the petal at real z; camera trails `petal.z + 11` and looks `petal.z − 30`; sky/ground/clouds track the camera so the world visibly scrolls.
2. **Direction flip (controls).** The whole scene now flies **toward −z** (three.js's native forward). Trail: `zStart = 40` descending to `zEnd`; `steer.advance` moves `z −= speed·cos(bank)·dt`; camera at `petal.z + 11` looking toward `−petal.z`. LEFT = −x = screen-left, RIGHT = +x = screen-right. **This required updating two unit tests** (`steer.test.js`, `trail.test.js`) — they now assert descending z. All 33 still pass.
3. **Flower look.** Absorbed `Spheres` became merged **5-petal flower geometry** (petal tori-esque ellipsoids + center sphere, flattened, `mergeGeometries` from `three/addons/utils/BufferGeometryUtils.js`). Player flower is bigger (`petalRadius 0.95`, previously a `0.55` sphere — roughly 3× the visual bulk); buds are `0.55` flower instances with per-instance pastel tint; mother bloom is a large `1.15` pulsing flower.
4. **Start-input bleed.** Space/Enter pressed while the title is up used to both Start *and* steer. Added `isTitleOpen` guard in `main.js` so pre-start keys never leak into `input`.

### Untested-in-browser remaining risk

The direction flip + flower meshes + camera rig are **unit-verified** (33/33) and **served fresh** (md5 disk==served), but the **on-page fly test** was interrupted by this file request and has not been re-run. Next agent's first action should be:

```text
1. git status → confirm the 6 modified paths above.
2. node --test 'flowerpetal/test/*.test.js' → expect 33 pass.
3. Browser at http://127.0.0.1:8000/flowerpetal/: click Start;
   assert the flower drifts forward (its z decreases), RIGHT visibly turns screen-right,
   LEFT screen-left, flowers-not-spheres in the screenshot, console clean.
4. Commit the batch when green: "fix(petal-bloom): -z flight, screen-correct banking,
   flower visuals, start input guard".
```

## 8. Known open threads / future work (if you build further)

- **Oscillate-and-stop one-switch mode** (the big one — §6). Add `aimer` oscillation + press-to-commit, behind a setting. Should reuse the hub's vocabulary: `Auto Scan On — One Switch / Off — Two Switches`.
- **Hold progress feedback** on the bank (filling ring + rising tone), per the guide.
- **TTS** via `NarbeVoiceManager` if the game ever joins the hub; short labels.
- **Difficulty as trail curvature/speed** — keep it a setting, default to the accessible end (the guide's rule).
- **Pause** (Esc/P hides camera, Resume/Restart) — the game is inherently safe when idle, so pause is optional, not required.
- **Merge decision** — `petal-bloom` is 13 commits ahead of `main` plus the fix batch. Merging to `main` (then pushing to GitHub Pages) remains the user's call; ask before doing it.

## 9. Deliverables checklist (definition of done)

- [ ] 33/33 unit tests pass
- [ ] Browser: title → Start → forward drift, correct LEFT/RIGHT on screen → collect buds → grow → bloom → next meadow → reload restores size → two-step reset clears
- [ ] Console clean, no `__lastError`
- [ ] Fix batch committed with the message in §7
- [ ] Flowers (not spheres) visible