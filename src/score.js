import { COLOR_NAMES, POSE_NAMES } from './unicorn.js';

const HORNS = ['', 'bicorn', 'tricorn', 'quadricorn'];

export function scorePhoto(photo, cfg, state) {
  const total = photo.w * photo.h;
  const bonus = cfg.resBonus[state.res];
  const common = Math.max(...cfg.poseWeights);
  const subjects = [];

  for (const [id, s] of photo.subjects) {
    const coverage = s.n / total;
    // A subject too small to identify should not count at all -- otherwise a
    // dozen distant specks hand out a huge color-variety multiplier.
    if (coverage < cfg.minCoverage) continue;

    // Share of the frame, paid at this sensor's rate -- which is what makes a
    // bigger camera worth buying. The top tier is worth 6x the bottom, not 36x:
    // squaring the ladder would drown the pose and composition terms, which top
    // out at 100 each.
    const size = coverage * bonus;
    // Rarer poses are worth more, measured against the commonest one -- so
    // merely walking about, which is what they do 80% of the time, earns
    // nothing at all.
    const pose = Math.round(((common - cfg.poseWeights[s.pose]) / common) * 100);

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
    const gross = size + pose;
    const cropLoss = gross * (1 - cropF);
    const envLoss = gross * cropF * (1 - envF);
    const occLoss = gross * cropF * envF * (1 - occF);

    subjects.push({
      id,
      color: COLOR_NAMES[s.color],
      colorIndex: s.color,
      poseName: POSE_NAMES[s.pose],
      horns: s.horns,
      // Normalised centroid, y flipped into image space (readPixels is bottom-up).
      cx: s.sx / s.n / photo.w - 0.5,
      cy: 0.5 - s.sy / s.n / photo.h,
      size, pose,
      cEdge, cEnv, cOcc,
      cropLoss, envLoss, occLoss,
      // The extra horns pay on the animal that grew them: a bicorn is worth
      // double, a quadricorn quadruple, and only its own subtotal moves.
      subtotal: (gross - cropLoss - envLoss - occLoss) * (s.horns + 1),
    });
  }

  const composition = compose(subjects);
  // Framing is a multiplier rather than an addition. As a flat 0-100 bonus it
  // was invisible beside subtotals in the thousands on a good camera; as a
  // factor it matters just as much at every tier. Floored at a quarter so a
  // badly framed rarity is still worth something, never a demoralising zero.
  const framing = 0.25 + composition * 0.0125;
  const base = subjects.reduce((a, s) => a + s.subtotal, 0);
  const bonuses = bonusList(subjects);
  const multiplier = bonuses.reduce((a, b) => a * b.factor, 1);

  return {
    url: photo.url,
    subjects,
    composition,
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
    if (s.pose) out.push([' pose · ' + s.poseName, sign(s.pose)]);
    // Cut by the frame, hidden behind scenery, blocked by another unicorn: three
    // penalties that compound in order, but one number as far as the player is
    // concerned. Sub-point losses read as "-0", which looks like a bug.
    const loss = s.cropLoss + s.envLoss + s.occLoss;
    if (loss > 0.5) out.push([' obscured', sign(-loss)]);
    if (s.horns) out.push([' ' + HORNS[s.horns], '×' + (s.horns + 1)]);
  }
  if (subjects.length) out.push(['framing', '×' + Math.round(framing * 100) + '%']);
  for (const b of bonuses) out.push([b.label, '×' + b.factor]);
  return out;
}

const sign = (n) => (n > 0 ? '+' : '') + Math.round(n);

// Spread: the average distance between subjects, as a fraction of the frame.
// Herding everything into one corner is the mistake it punishes, and half a
// frame apart on average is full marks. A single subject has no pairs, so it is
// judged on how centred it is instead -- dead centre 100, corner 0.
function compose(subjects) {
  if (subjects.length === 1) {
    const s = subjects[0];
    return Math.round(100 * (1 - Math.hypot(s.cx, s.cy) / Math.SQRT1_2));
  }
  let sum = 0, pairs = 0;
  for (const a of subjects) {
    for (const b of subjects) {
      if (a === b) continue;
      sum += Math.hypot(a.cx - b.cx, a.cy - b.cy);
      pairs++;
    }
  }
  return pairs ? Math.min(100, Math.round((200 * sum) / pairs)) : 0;
}

function bonusList(subjects) {
  const out = [];
  const colors = new Set(subjects.map((s) => s.colorIndex));
  if (colors.size >= 2) {
    out.push({ label: colors.size + ' colors', factor: colors.size });
  }
  if (colors.size === 6) {
    out.push({ label: 'RAINBOW', factor: 2 });
  }
  return out;
}
