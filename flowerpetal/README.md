# Petal Bloom

A Flower-like drift game with extremely simplified controls: you are a petal,
always moving forward at a preset speed. Hold **LEFT** or **RIGHT** to bank and
steer; follow the glowing trail of buds down the meadow; each bud collected
grows you bigger. Reach the mother bloom at the trail's end and a brand-new
random meadow regenerates — endlessly. There is no fail state, no timer, and
your petal never shrinks.

## Controls

| Input | Action |
| --- | --- |
| `◀ LEFT` / `▶ RIGHT` on-screen buttons | Hold to bank left / right |
| `ArrowLeft`, `A`, `Space` | Steer left |
| `ArrowRight`, `D`, `Enter` | Steer right |
| Click/tap left or right half of the canvas | Steer that way |
| `M` | Toggle ambient music (also on the title card) |

Holding both turns straight. Releasing both returns to level flight.

## Audio

All sound is **synthesized at runtime** (WebAudio) — no audio files, so nothing
to license or attribute. The spacey/relaxing background is a generative
ambient pad: a slow crossfading chord drone (Dm9 → Cadd9 → Am9 → Fmaj7) plus
sparse pentatonic sparkle bells, with a breathing LFO. Collection chimes climb
a pentatonic ladder; the meadow bloom plays a soft C-major chord. Toggle the
ambient with `M` or the title-card checkbox; your preference is remembered.

## Run it

No build step. Serve the repo root with any static server, e.g.:

```bash
python3 -m http.server 8000
```

then open `http://localhost:8000/flowerpetal/` (or the site root and follow
the link). It uses three.js r160 from unpkg via an import map, so it needs a
network connection on first load.

## 3D models & attribution

The game uses third-party 3D models that require attribution. **Do not remove
the Credits view on the title card** (`Credits & models`) — it is the license
compliance surface.

| Model | Author | License | Source |
| --- | --- | --- | --- |
| Cherry blossom petal | Voyage (@voyagevoyage_vr) | CC BY 4.0 | https://sketchfab.com/3d-models/cherry-blossom-petal-a1e45d9f9796403ca855a6afa4613627 |

The model ships as `flowerpetal/assets/cherry-blossom-petal.obj` (parsed at
runtime into geometry — no GLTF loader needed). The credits list marks it
"in use" once loaded; the CC BY license is honored by the bundled Credits
view and this table.

## Progress

- Size, total buds, and blooms autosave to `localStorage` on every collection
  and meadow bloom.
- `Reset progress` on the title card wipes the save (two-step confirm).

## Tests

Pure logic modules (trail generation, growth math, save/load, steering,
meadow lifecycle, pitch ladder) are unit-tested with Node's built-in runner:

```bash
node --test 'flowerpetal/test/*.test.js'
```

## Structure

```
flowerpetal/
  index.html          # page, HUD, title card, import map
  src/
    main.js           # boot, game loop, input, collection, meadows (thin glue)
    render.js         # three.js scene, instanced buds, camera, clouds, rings
    trail.js          # random trail generation + curvature invariant (pure)
    steer.js          # bank/turn math (pure)
    growth.js         # size curve, tint gradient, collection state (pure)
    meadow.js         # meadow lifecycle transitions (pure)
    state.js          # save/load with injected storage (pure)
    notes.js          # pentatonic pitch ladder (pure)
    audio.js          # synthesized chimes/bloom chord (WebAudio)
  test/               # node --test suites for the pure modules
```