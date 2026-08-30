## Chromazoa — js13k 2026

Theme: **Rainbows and Unicorns**.

Breed and grow robots from a DNA-like genetic code. Three bases — `R`, `G`, `B` — are read
three at a time. Each codon expresses one block of the robot's body.

### The genetic code

A codon's colour is the count of each letter mapped through `[0, 64, 128, 255]`:

| codon | rgb |
| --- | --- |
| `RRR` | 255, 0, 0 |
| `RBB` | 64, 0, 128 |
| `RBG` | 64, 64, 64 |

The six codons that contain one of each letter (`RGB` `RBG` `GRB` `GBR` `BRG` `BGR`) are
therefore all grey. Grey means "no colour", so those six are the control ops rather than
blocks. That leaves exactly 21 functional blocks.

```
RGB  STOP        end this branch
RBG  PUSH        save position + heading, start a side branch
GRB  POP         return to the last PUSH
GBR  TURN LEFT
BRG  TURN RIGHT
BGR  NOP
```

Growth is a turtle on a square grid. The read head is an anchor — the last block placed —
plus a heading; a functional codon lays its block in the cell next to the anchor. So a turn
pivots around the last block and takes effect immediately, which is what lets a branch leave
the trunk in a different direction instead of fighting it for the same cell. Growing into an
occupied cell kills that branch.

Because the genome is read in fixed groups of three, an inserted or deleted base is a
**frameshift** — every codon downstream changes, and the robot is reborn as something else
entirely.

## Prerequisites

1. install node
2. install npm

## To run

```
npm install
npm run build-dev
```

Then open `./docs/index.html` in your browser.

## Other scripts

```
  "build-prod": "webpack --mode=production",
  "build-dev": "webpack --mode=development",
  "build-watch": "webpack --mode=development --watch"
```

`node generate-icons.js` regenerates the PWA icons (needs the native `canvas` package).
