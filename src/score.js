import { COLOR_NAMES, POSE_NAMES } from './unicorn.js';

const HORNS = ['', 'bicorn', 'tricorn', 'quadricorn'];

export function scorePhoto(photo, cfg, state) {
  const total = photo.w * photo.h;
  const bonus = cfg.resBonus[state.res];
  const subjects = [];

  for (const [id, s] of photo.subjects) {
    const coverage = s.n / total;
    // A subject too small to identify should not count at all -- otherwise a
    // dozen distant specks hand out a huge color-variety multiplier.
    if (coverage < cfg.minCoverage) continue;

    // How big the animal comes out, paid at this sensor's rate -- which is what
    // makes a bigger camera worth buying. Measured as the share of the frame it
    // actually fills: the square root read fairer on paper, but it paid a speck
    // on the horizon a third of what a unicorn filling the frame was worth, so
    // there was little reason to work for the close shot. On area the range is
    // the real one, and getting close is the strongest thing a photographer does.
    const size = coverage * bonus;
    // The moment, as a multiplier rather than something added on. As `size + pose`
    // a 98-point pose swamped a 6-point size, so the camera you saved for and the
    // distance you worked for were both noise beside a dice roll. Multiplied, the
    // three things a good photograph does compound instead of competing: get
    // close, own a better sensor, catch a rare moment.
    //
    // Modest on purpose. Derived from rarity it ran to 6.3x for a neighing
    // unicorn, which made the roll a lottery on what the herd happened to be
    // doing; at 1.9x the rare pose is a bonus on a well-taken photograph rather
    // than a substitute for taking one well.
    const pose = cfg.poseBonus[s.pose];

    // How much of the outline is cut, and by what. A flat penalty for touching
    // an edge was a cliff: a clipped hoof cost the same as half a missing
    // unicorn. These grade instead.
    const out = s.outline || 1;
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
      color: COLOR_NAMES[s.color],
      colorIndex: s.color,
      poseName: POSE_NAMES[s.pose],
      horns: s.horns,
      // Normalised centre of the neck, y flipped into image space (readPixels is
      // bottom-up). An animal facing away, or with its neck behind a rock, has no
      // neck pixels at all and falls back to its whole-body centroid -- it still
      // has to be framed somehow.
      cx: (s.nn ? s.nx / s.nn : s.sx / s.n) / photo.w - 0.5,
      cy: 0.5 - (s.nn ? s.ny / s.nn : s.sy / s.n) / photo.h,
      size, pose,
      cEdge, cEnv, cOcc,
      cropLoss, envLoss, occLoss,
      // The extra horns pay on the animal that grew them, and only its own
      // subtotal moves: 20% more per horn, so a quadricorn is worth half as much
      // again. One step of the same 20% the colour bonus pays, which is the only
      // thing on this card that lets a player read one multiplier and know what
      // the next one would be worth. Written `* 0.2` rather than the colour
      // bonus's equivalent `/ 5` purely because roadroller charges 3 bytes less
      // for it, and we are sitting on the limit exactly.
      //
      // Cut twice now, from double-to-quadruple and then from x1.5-to-x2.5. A
      // freak animal is a bonus on a photograph, not a substitute for taking one:
      // it cannot outweigh getting close, and it should not.
      subtotal: (gross - cropLoss - envLoss - occLoss) * (1 + s.horns * 0.2),
    });
  }

  // Framing is a multiplier rather than an addition. As a flat 0-100 bonus it
  // was invisible beside subtotals in the thousands on a good camera; as a
  // factor it matters just as much at every tier.
  const framing = compose(subjects);
  const base = subjects.reduce((a, s) => a + s.subtotal, 0);
  const bonuses = bonusList(subjects);
  const multiplier = bonuses.reduce((a, b) => a * b.factor, 1);

  return {
    url: photo.url,
    subjects,
    framing,
    bonuses,
    multiplier,
    total: Math.round(base * framing * multiplier),
    b: breakdown(subjects, framing, bonuses, bonus),
  };
}

// The one breakdown format in the game: a flat list of [label, value], both
// already strings. It is what a photo's own screen draws, what the winner's card
// draws, and -- because it is nothing but short strings -- what goes on the wire
// so a rival's winning card can be drawn too.
//
// A leading space marks a detail row. One character, it survives the wire's
// character whitelist, and it saves carrying a third field per row just to say
// "indent me".
function breakdown(subjects, framing, bonuses, dpi) {
  const out = [];
  for (const s of subjects) {
    // Just the color: a scored pose already names itself on its own detail row
    // below, and heading the subject with it too read as a stutter.
    out.push([s.color, '' + Math.round(s.subtotal)]);
    // The size row shows its own arithmetic: the share of the frame this animal
    // fills, times what the sensor pays for a share. They multiply out to
    // exactly the points beside them, which is the only thing on screen that
    // says why the resolution upgrade is worth buying.
    out.push([' size · ' + (s.size / dpi * 100).toFixed(1) + '% × ' + dpi + 'dpi', sign(s.size)]);
    if (s.pose > 1) out.push([' pose · ' + s.poseName, pct(s.pose)]);
    // Cut by the frame, hidden behind scenery, blocked by another unicorn: three
    // penalties that compound in order, but one number as far as the player is
    // concerned. Sub-point losses read as "-0", which looks like a bug.
    const loss = s.cropLoss + s.envLoss + s.occLoss;
    if (loss > 0.5) out.push([' obscured', sign(-loss)]);
    if (s.horns) out.push([' ' + HORNS[s.horns], pct(1 + s.horns * 0.2)]);
  }
  // Shown as the adjustment it is, not as a total: a shot scoring a twentieth of
  // its subtotals reads -95%, and a perfect frame +100%.
  if (subjects.length) out.push(['framing', pct(framing)]);
  for (const b of bonuses) out.push([b.row || b.label, pct(b.factor)]);
  return out;
}

const sign = (n) => (n > 0 ? '+' : '') + Math.round(n);
// Every multiplier on the breakdown, said the one way: how much more, or less,
// than the photograph's parts add up to. A pose at ×2.2 beside a framing at -40%
// read as two different kinds of number, and neither said what the next one of
// the same thing would be worth. Parity prints a plain 0%, which sign() leaves
// unsigned and so uncolored.
const pct = (f) => sign((f - 1) * 100) + '%';

// Framing, x0.05 to x2. Two mistakes, punished on the same curve and multiplied
// together so neither can be bought off with the other: herding the animals on
// top of each other, and letting one drift into the edge of the frame.
//
// The curve is logarithmic, which puts the resolution where the decisions are --
// a tenth of the way to a comfortable distance still scores under a tenth, while
// everything past comfortable is flat. It is exactly 0 at nothing and exactly 1
// at the reference distance, so both ends of the range stay calculable.
const K = 3, LK = Math.log(1 + K);
const f = (d, D) => Math.log(1 + (K * Math.min(d, D)) / D) / LK;

// The two terms pull against each other: spreading out to earn separation walks
// everyone towards the edges. Against fixed distances only a lone unicorn could
// ever satisfy both, and every crowd shot would be capped short of the ceiling.
// So the references are whatever an ideal arrangement of this many subjects
// actually achieves -- evenly spaced on a circle that widens as the crowd grows,
// one animal dead centre, six in a ring -- and the top of the range stays
// reachable however many turned up.
function compose(subjects) {
  const N = subjects.length;
  if (!N) return 0.05;
  const r = 0.35 * Math.sqrt(1 - 1 / N);
  // Capped a little short of the frame's half-width, so a lone subject has some
  // slack at the centre rather than one exact pixel of it.
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

// A fifth of the photograph for every colour in it, added rather than
// compounded, and the full set doubled on top: six colours is x4.4 where the
// bare count made it x12. At x12 the rainbow was not a bonus, it was the only
// shot in the game worth taking -- one lucky crowd outscored a whole roll of
// deliberate photographs.
//
// The label carries the arithmetic, the way the size row does: `3 colors × 20%`
// earning `+60%` says what a fourth colour would be worth, where a bare `×1.6`
// said only what this one happened to come to.
function bonusList(subjects) {
  const c = new Set(subjects.map((s) => s.colorIndex));
  // One black unicorn large enough to score voids the photograph, and nothing
  // else about the shot is worth saying once it has. Returning early is also the
  // only way the colour rows stay honest: five rainbow coats plus a black one is
  // six distinct colours, and would otherwise print RAINBOW on a zeroed card.
  if (c.has(6)) return [{ label: 'black unicorn', factor: 0 }];
  const out = [];
  const n = c.size;
  // Two names for the one bonus: `label` is what the roll summary lists beside a
  // shot, where a rate would be noise, and `row` is the breakdown's, which shows
  // the arithmetic the way the size row does -- `3 colors · 3 × 20%` earning
  // `+60%` says what a fourth colour would be worth, where a bare `+60%` said
  // only what this one came to.
  if (n >= 2) {
    out.push({ label: n + ' colors', row: n + ' colors · ' + n + ' × 20%',
               factor: 1 + n / 5 });
  }
  if (n === 6) out.push({ label: 'RAINBOW', factor: 2 });
  return out;
}
