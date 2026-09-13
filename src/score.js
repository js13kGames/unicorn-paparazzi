import { COLOR_NAMES, POSE_NAMES } from './unicorn.js';

const HORNS = ['', 'bicorn', 'tricorn', 'quadricorn'];

export function scorePhoto(photo, cfg, state) {
  const total = photo.w * photo.h;
  const bonus = cfg.resBonus[state.rs];
  const subjects = [];
  // Too small to photograph properly: a point each and a vote in what colors are
  // in frame, nothing more. Below a tenth of minCoverage they do not even reach
  // this list -- a handful of stray pixels is not a photograph of anything, and a
  // dark coat out there would otherwise void the shot.
  const smalls = [];

  for (const [id, s] of photo.subjects) {
    const coverage = s.n / total;
    if (coverage < cfg.minCoverage * .1) continue;
    if (coverage < cfg.minCoverage) { smalls.push(s.coat); continue; }

    // Share of the frame filled, paid at this sensor's rate. Area, not its square
    // root: on the root a distant speck was worth a third of a frame-filling
    // animal, and there was little reason to work for the close shot.
    const size = coverage * bonus;
    // A multiplier, not an addition: added, a big pose score swamped size, and the
    // camera you saved for was noise beside a dice roll. Modest on purpose -- the
    // rare pose is a bonus on a well-taken photograph, not a substitute for one.
    const pose = cfg.poseBonus[s.stance];

    // How much of the outline is cut, and by what. Graded, not flat: a clipped hoof
    // must not cost what half a missing unicorn does.
    const out = s.rim || 1;
    const cEdge = s.edge / out, cEnv = s.env / out, cOcc = s.occ / out;
    const cropF = Math.exp(-cfg.cropK * cEdge);
    const envF = Math.exp(-cfg.envK * cEnv);
    // Linear, and floored: standing in a crowd should cost you, but a crowd is
    // the whole point of the rainbow shot, so it cannot zero a subject out.
    const occF = Math.max(0.25, 1 - cfg.occK * cOcc);

    // Applied in sequence so the displayed deductions still sum to the subtotal.
    const gross = size * pose;
    const cropLoss = gross * (1 - cropF);
    const envLoss = gross * cropF * (1 - envF);
    const occLoss = gross * cropF * envF * (1 - occF);

    subjects.push({
      id,
      coat: COLOR_NAMES[s.coat],
      colorIndex: s.coat,
      poseName: POSE_NAMES[s.stance],
      horns: s.horns,
      // Normalised centre of the neck, y flipped into image space (readPixels is
      // bottom-up). No neck pixels at all falls back to the body centroid.
      cx: (s.nn ? s.nx / s.nn : s.sx / s.n) / photo.w - 0.5,
      cy: 0.5 - (s.nn ? s.ny / s.nn : s.sy / s.n) / photo.h,
      extent: size, stance: pose,
      cEdge, cEnv, cOcc,
      cropLoss, envLoss, occLoss,
      // 20% per extra horn, on this animal's subtotal alone -- the same step the
      // colour bonus pays, so one multiplier tells you what the next is worth.
      // `* 0.2` rather than `/ 5` because roadroller charges 3 bytes less for it.
      subtotal: (gross - cropLoss - envLoss - occLoss) * (1 + s.horns * 0.2),
    });
  }

  // A multiplier, not an addition: a flat bonus was invisible beside subtotals in
  // the thousands on a good camera.
  const framing = compose(subjects);
  let base = 0;
  for (const s of subjects) base += s.subtotal;
  const bonuses = bonusList(subjects, smalls);
  let multiplier = 1;
  for (const b of bonuses) multiplier *= b.factor;

  return {
    pic: photo.pic,
    subjects,
    framing,
    bonuses,
    multiplier,
    // Framing is paid on the subjects alone, so a speck at the edge cannot drag the
    // arrangement you meant to shoot. The multiplier is paid on everything, which
    // is what lets a dark speck's factor of 0 zero the whole photograph.
    sum: Math.round((base * framing + smalls.length) * multiplier),
    b: breakdown(subjects, framing, bonuses, bonus, smalls),
  };
}

// The one breakdown format in the game: a flat list of [label, value], both
// strings, drawn by every card and small enough to go on the wire.
//
// A leading space marks a detail row -- one character, it survives the wire's
// whitelist, and it saves a third field per row.
function breakdown(subjects, framing, bonuses, dpi, smalls) {
  const out = [];
  for (const s of subjects) {
    out.push([s.coat, '' + Math.round(s.subtotal)]);
    // The size row shows its own arithmetic -- frame share x what the sensor pays,
    // multiplying out to exactly the points beside it. It is the only thing on
    // screen that says why the dpi upgrade is worth buying.
    out.push([' size · ' + (s.extent / dpi * 100).toFixed(1) + '% × ' + dpi + 'dpi', sign(s.extent)]);
    if (s.stance > 1) out.push([' pose · ' + s.poseName, pct(s.stance)]);
    // Three penalties compound in order, but one number as far as the player is
    // concerned. Sub-point losses would read "-0", which looks like a bug.
    const loss = s.cropLoss + s.envLoss + s.occLoss;
    if (loss > 0.5) out.push([' obscured', sign(-loss)]);
    if (s.horns) out.push([' ' + HORNS[s.horns], pct(1 + s.horns * 0.2)]);
  }
  // The horizon herd as one block: a point apiece is not worth a line apiece, but
  // which colors are out there decides the color bonus. Palette order, dark last.
  if (smalls.length) {
    out.push(['small unicorns', sign(smalls.length)]);
    for (let i = 0; i < COLOR_NAMES.length; i++) {
      const n = smalls.filter((c) => c === i).length;
      if (n) out.push([' ' + COLOR_NAMES[i] + ' · ' + n, sign(n)]);
    }
  }
  // An adjustment, not a total: a twentieth reads -95%, a perfect frame +100%.
  if (subjects.length) out.push(['framing', pct(framing)]);
  for (const b of bonuses) out.push([b.row || b.legend, pct(b.factor)]);
  return out;
}

const sign = (n) => (n > 0 ? '+' : '') + Math.round(n);
// Every multiplier on the breakdown, said one way: how much more or less than the
// parts add up to. Parity prints a plain 0%, which sign() leaves unsigned and so
// uncoloured.
const pct = (f) => sign((f - 1) * 100) + '%';

// Framing, x0.05 to x2. Two mistakes -- crowding the animals together, and letting
// one drift into the edge -- on the same curve and multiplied, so neither can be
// bought off with the other.
//
// Logarithmic, which puts the resolution where the decisions are, and exactly 0 at
// nothing and 1 at the reference distance so both ends stay calculable.
const K = 3, LK = Math.log(1 + K);
const f = (d, D) => Math.log(1 + (K * Math.min(d, D)) / D) / LK;

// The two terms pull against each other: spreading out to earn separation walks
// everyone towards the edges. So the references are what an ideal arrangement of
// THIS many subjects achieves -- evenly spaced on a circle that widens with the
// crowd -- and the top of the range stays reachable however many turned up.
function compose(subjects) {
  const N = subjects.length;
  if (!N) return 0.05;
  const r = 0.35 * Math.sqrt(1 - 1 / N);
  // Capped short of the half-width, so a lone subject has slack at the centre.
  const DE = Math.min(0.45, 0.5 - r);

  // Every subject's distance to the nearest edge, averaged.
  let edge = 0;
  for (const s of subjects) {
    edge += f(Math.min(0.5 - Math.abs(s.cx), 0.5 - Math.abs(s.cy)), DE);
  }
  edge /= N;

  // Mean distance over every ordered pair, against the same mean for the ideal
  // ring, which is a closed form. A lone subject has no pairs and no crowd.
  let spread = 1;
  if (N > 1) {
    let sum = 0, pairs = 0, ring = 0;
    for (const a of subjects) {
      for (const b of subjects) {
        if (a === b) continue;
        sum += Math.hypot(a.cx - b.cx, a.cy - b.cy);
        pairs++;
      }
    }
    for (let k = 1; k < N; k++) ring += 2 * r * Math.sin((Math.PI * k) / N);
    spread = f(sum / pairs, ring / (N - 1));
  }

  return 0.05 + 1.95 * edge * spread;
}

// A fifth of the photograph per colour, added rather than compounded, and the full
// set doubled on top: six colours is x4.4. Compounded it reached x12, at which the
// rainbow was not a bonus but the only shot in the game worth taking.
function bonusList(subjects, smalls) {
  const big = new Set(subjects.map((s) => s.colorIndex));
  // What colors are in frame at all: a speck counts here and nowhere else.
  const c = new Set([...big, ...smalls]);
  // One dark unicorn voids the photograph. Returning early is also what keeps the
  // colour rows honest: five coats plus a dark one is six distinct colours, and
  // would otherwise print RAINBOW on a zeroed card.
  if (c.has(6)) return [{ legend: 'dark unicorn', factor: 0 }];
  const out = [];
  const n = c.size;
  // Two names for one bonus: `legend` for the roll summary, `row` for the
  // breakdown, which shows the arithmetic so a fourth colour's worth is readable.
  if (n >= 2) {
    out.push({ legend: n + ' colors', row: n + ' colors · ' + n + ' × 20%',
               factor: 1 + n / 5 });
  }
  // The one thing specks cannot buy: the doubling demands six animals photographed
  // properly, or the whole-valley shot from as far back as possible wins again.
  if (big.size === 6) out.push({ legend: 'RAINBOW', factor: 2 });
  return out;
}
