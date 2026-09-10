## Unicorn Snap — js13k 2026

Theme: **Rainbows and Unicorns**.

A cart carries you once around a rail loop through a procedurally generated
island. You can look anywhere you like but you cannot stop, you have a fixed
roll of film, and the herds do not wait. Photograph them; the photographs are
scored; the points buy better glass.

Get all six unicorn colours into one frame and you win.

### How it is put together

Everything is raw WebGL2 — no framework. The whole world is derived from one
seed, so the same seed builds the same island on any machine.

| file | |
| --- | --- |
| `src/rng.js` | seeded PRNG and value-noise fBm |
| `src/mat.js` | perspective, multiply, yaw/pitch view matrix |
| `src/gl.js` | context, program + uniform cache, VAO and data-texture helpers |
| `src/terrain.js` | elevation bands, biomes, track path, carve, meshes |
| `src/unicorn.js` | box model, pose table, spawning, herd simulation |
| `src/render.js` | terrain, track and instanced herd; shared ID pass |
| `src/photo.js` | shutter: thumbnail + ID-buffer readback |
| `src/score.js` | the scoring rubric |
| `src/ui.js` | HUD, viewfinder, review screens |
| `src/index.js` | `CONFIG`, state machine, main loop |

**Terrain** is two fields. `band` holds quantised integer elevations and decides
colour, biome and which unicorn colour lives where. A separate `height` field is
that same band blurred, with a fine noise layer added back, and it drives the
geometry — so the ground rolls while the biomes stay put. The mesh is an indexed
grid over the `(N+1)²` corners with analytic normals, which is why there are no
stair-steps and no walls.

**The track** is its own ribbon mesh generated from the path polyline rather than
painted onto the terrain grid, because shared grid vertices can only ever give a
blurred edge. Each cross-section sits at the highest ground beneath the full
width of the bed, so it never gets pierced on a grade.

**Unicorns** are one instanced draw call. Every vertex names the body part it
belongs to; the four poses × 16 animation frames are baked into a lookup texture
of part matrices, so animating the whole herd costs one float per animal.

**Scoring** works off an ID pass. After the shutter, the scene is drawn again
into a small offscreen buffer with each unicorn in a flat colour keyed to its
instance id. One `readPixels` gives every term in the rubric at once — who is in
frame, how much of it each fills, who is clipped by an edge, and where each sits
— with occlusion handled for free by the depth buffer.

### Prerequisites

Node and npm.

### To run

```
npm install
npm run build-dev
```

Then serve `docs/` and open `index.html` (a plain `file://` open works too).

### To build the submission

```
npm run build-prod
```

This minifies with Terser, compresses the bundle with
[Roadroller](https://github.com/lifthrasiir/roadroller), inlines the result into
a single self-contained page at `docs/dist/index.html`, and writes the archive to
`docs/game.zip`. The build prints the size against the 13,312-byte budget and
fails if it goes over.

Roadroller re-serialises JavaScript rather than round-tripping it byte for byte,
so `build/pack.mjs` decodes its own output and compares it to the bundle through
Terser's printer. A corrupted payload or a mis-parse fails the build rather than
shipping.

### Other scripts

```
  "build-dev": "webpack --mode=development",
  "build-watch": "webpack --mode=development --watch",
  "pack": "node build/pack.mjs"
```
