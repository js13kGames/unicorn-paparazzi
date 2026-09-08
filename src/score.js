import { COLOR_NAMES, POSE_NAMES } from './unicorn.js';

// The four rule-of-thirds power points, in a frame normalised to [-0.5, 0.5].
const HORNS = ['', 'bicorn', 'tricorn', 'quadricorn'];

const THIRDS = [[-1 / 6, -1 / 6], [1 / 6, -1 / 6], [-1 / 6, 1 / 6], [1 / 6, 1 / 6]];
// Worst case distances, used to normalise each composition term to [0, 1].
const MAX_CENTRE = Math.SQRT1_2;              // corner to centre, ~0.707
const MAX_THIRD = Math.hypot(1 / 3, 1 / 3);   // corner to its nearest third

export function scorePhoto(photo, cfg, state) {
  const total = photo.w * photo.h;
  const res = cfg.resFactor[state.res];
  const common = Math.max(...cfg.poseWeights);
  const sensorPx = res * 4320 * res * 4320 * (photo.w / photo.h);
  const subjects = [];

  for (const [id, s] of photo.subjects) {
    const coverage = s.n / total;
    // A subject too small to identify should not count at all -- otherwise a
    // dozen distant specks hand out a huge colour-variety multiplier.
    if (coverage < cfg.minCoverage) continue;

    // Size counts the unicorn's ACTUAL pixels, not its share of the frame, which
    // is what makes a bigger sensor worth buying: the same shot at 8K simply has
    // more unicorn in it. `res` is the tier's height over 4320, so
    //   sqrt(coverage) * res  ==  sqrt(subjectPixels / 8K pixels)
    // exactly -- the aspect ratio cancels, so this holds at any window shape.
    // A unicorn filling an 8K frame still scores 100, as specified.
    const size = Math.min(100, 100 * Math.sqrt(coverage) * res);
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
      // What the size term is actually counting: unicorn pixels in a photograph
      // of this sensor's real dimensions.
      px: Math.round(coverage * sensorPx),
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

// One subject wants the middle of the frame. Two to four want the rule of
// thirds -- there are exactly four power points, so each can own one. Beyond
// that the thirds test breaks down: matching every subject to its *nearest*
// point lets six animals piled on one corner score full marks, which is not a
// composition. A crowd is judged as a crowd instead -- centred as a group, and
// spread across the frame rather than heaped.
function compose(subjects) {
  const n = subjects.length;
  if (!n) return 0;
  if (n === 1) {
    const s = subjects[0];
    return Math.round(100 * Math.max(0, 1 - Math.hypot(s.cx, s.cy) / MAX_CENTRE));
  }
  if (n > THIRDS.length) {
    let mx = 0, my = 0;
    for (const s of subjects) { mx += s.cx; my += s.cy; }
    mx /= n; my /= n;
    let spread = 0;
    for (const s of subjects) spread += Math.hypot(s.cx - mx, s.cy - my);
    spread = Math.min(1, spread / n / 0.25);
    const balance = Math.max(0, 1 - Math.hypot(mx, my) / MAX_CENTRE);
    return Math.round(100 * balance * (0.35 + 0.65 * spread));
  }
  let sum = 0;
  for (const s of subjects) {
    let best = Infinity;
    for (const [tx, ty] of THIRDS) best = Math.min(best, Math.hypot(s.cx - tx, s.cy - ty));
    sum += Math.max(0, 1 - best / MAX_THIRD);
  }
  return Math.round((100 * sum) / n);
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
    out.push({ label: 'RAINBOW', factor: 2, rainbow: true });
  }
  return out;
}
