# Tests

`npm test` runs every suite in `suites/`. There is no browser in this loop, so
these are the whole safety net — each one exists because something broke without
being noticed.

The game is ESM inside a CommonJS package, and the suites import the *real*
source rather than a copy, so `run.mjs` mirrors `src/*.js` into `.mirror/*.mjs`
(rewriting import extensions) on every run. `.mirror` is generated and gitignored;
a suite therefore can never drift from the code it tests.

Run one suite with `npm test <prefix>`, e.g. `npm test scoring`.

## Suites — assert, and fail the run

| | what it protects |
| --- | --- |
| `scoring` | the whole rubric: absolute-pixel size, pose rarity, outline contact (crop / scenery / crowd), composition, color and horn bonuses, the bait penalty |
| `lures` | lures gather, reach differs between weak and strong, and they pull every color |
| `flight` | ballistics against the real launch constants read out of `src/index.js`; a 45° throw must still carry ~190 units |
| `cooldown` | the shutter **gate**, driven from the real `takePhoto` guard. An earlier version tested only the readout, so a cooldown that blocked nothing passed |
| `water` | the track never lifts open sea above the waterline |
| `span` | over water the rails hold their line with nothing under them |
| `ribbon` | terrain never pierces the track ribbon, across 12 seeds |
| `save` | old saves migrate without losing bank or upgrades |
| `hud` | film counter, lure belt, viewfinder scaling, results ordering, and that the shutter flash re-arms on *every* shot |

## Tools — render or measure, for judging by eye

No assertions; they print or write a PNG. `model`, `scene`, `capture`, `win`,
`beacon` and `preview` are software rasterisers that mirror the GLSL, which is
how the look gets checked without a GPU. `rainbow`, `sweep`, `reach` and
`winsweep` answer balance questions ("is the win reachable?", "is anything in
range?"). `profile` and `water` shaped the track-over-sea work.

```
node test/tools/scene.mjs out.png      # the world from four points on the track
node test/tools/model.mjs out.png      # the unicorn in every pose
node test/tools/capture.mjs out.png    # shots scored through the real ID pass
node test/tools/rainbow.mjs            # can a strong lure stage six colors?
```

They need the `canvas` dev dependency.

## Build-time checks

`npm run build-prod` also runs `build/check-shaders.mjs`, which fails the build on
GLSL that would only break in a browser, and on any `CONFIG.<key>` that does not
resolve — a missing key once disabled the shutter cooldown silently.
