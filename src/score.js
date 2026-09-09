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
    // dozen distant specks hand out a huge colour-variety multiplier.
    if (coverage < cfg.minCoverage) continue;

    // Share of the frame, paid at this sensor's rate -- which is what makes a
    // bigger camera worth buying. The top tier is worth 6x the bottom, not 36x:
    // squaring the ladder would drown the pose and composition terms, which top
    // out at 100 each.
    const size = coverage * bonus;
    // Rarer poses are worth more, measured against the commonest one -- so
    // merely standing about, which is what they do 80% of the time, earns
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
      colour: COLOR_NAMES[s.color],
      colourIndex: s.color,
      poseName: POSE_NAMES[s.pose],
      cov: coverage,
      horns: s.horns,
      // Normalised centroid, y flipped into image space (readPixels is bottom-up).
      cx: s.sx / s.n / photo.w - 0.5,
      cy: 0.5 - s.sy / s.n / photo.h,
      size, pose,
      cEdge, cEnv, cOcc,
      cropLoss, envLoss, occLoss,
      subtotal: gross - cropLoss - envLoss - occLoss,
    });
  }

  const composition = compose(subjects);
  const base = subjects.reduce((a, s) => a + s.subtotal, 0) + composition;
  const bonuses = bonusList(subjects);
  const multiplier = bonuses.reduce((a, b) => a * b.factor, 1);

  return {
    url: photo.url,
    // Carried so the breakdown can show the multiply it did, without taking cfg.
    resBonus: bonus,
    subjects,
    composition,
    base,
    bonuses,
    multiplier,
    // A flat toll, applied after the multiplier: showing your bait costs 200
    // points, not 200 times whatever the colour bonus was.
    bait: photo.bait ? cfg.baitPenalty : 0,
    total: Math.max(0, Math.round(base * multiplier) - (photo.bait ? cfg.baitPenalty : 0)),
  };
}

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
  const colours = new Set(subjects.map((s) => s.colourIndex));
  // The rarest head in the frame pays: two horns double the shot, four quadruple it.
  const horns = Math.max(0, ...subjects.map((s) => s.horns));
  if (horns) {
    out.push({ label: HORNS[horns], factor: horns + 1 });
  }
  if (colours.size >= 2) {
    out.push({ label: colours.size + ' colours', factor: colours.size });
  }
  if (colours.size === 6) {
    out.push({ label: 'RAINBOW', factor: 2 });
  }
  return out;
}
