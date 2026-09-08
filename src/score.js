import { COLOR_NAMES, POSE_NAMES } from './unicorn.js';

// The four rule-of-thirds power points, in a frame normalised to [-0.5, 0.5].
const THIRDS = [[-1 / 6, -1 / 6], [1 / 6, -1 / 6], [-1 / 6, 1 / 6], [1 / 6, 1 / 6]];
// Worst case distances, used to normalise each composition term to [0, 1].
const MAX_CENTRE = Math.SQRT1_2 / 1;          // corner to centre, ~0.707
const MAX_THIRD = Math.hypot(1 / 3, 1 / 3);   // corner to its nearest third

export function scorePhoto(photo, cfg, state) {
  const total = photo.w * photo.h;
  const res = cfg.resFactor[state.res];
  const subjects = [];

  for (const [id, s] of photo.subjects) {
    const coverage = s.n / total;
    // A subject too small to identify should not count at all -- otherwise a
    // dozen distant specks hand out a huge colour-variety multiplier.
    if (coverage < cfg.minCoverage) continue;

    // 100 points is still a unicorn filling an 8K frame, but on a square-root
    // curve. Linear coverage made this term worth ~2 points for a well-framed
    // subject against a flat 20 for merely standing, so framing stopped
    // mattering and only the head-count did.
    const size = Math.min(100, 100 * Math.sqrt(coverage) * res);
    // Rarer poses are worth more, straight from the pose schedule.
    const pose = Math.round(100 - cfg.poseWeights[s.pose] * 100);
    const clipped = s.minx <= 0 || s.maxx >= photo.w - 1 || s.miny <= 0 || s.maxy >= photo.h - 1;
    const crop = clipped ? -25 : 0;
    const baby = s.adult ? 0 : 25;

    subjects.push({
      id,
      colour: COLOR_NAMES[s.color],
      colourIndex: s.color,
      poseName: POSE_NAMES[s.pose],
      adult: !!s.adult,
      coverage,
      // Normalised centroid, y flipped into image space (readPixels is bottom-up).
      cx: s.sx / s.n / photo.w - 0.5,
      cy: 0.5 - s.sy / s.n / photo.h,
      size, pose, crop, baby,
      subtotal: size + pose + crop + baby,
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
    total: Math.max(0, Math.round(base * multiplier)),
  };
}

// One subject wants the middle of the frame; two or more want the rule of
// thirds, each measured against whichever power point it is nearest.
function compose(subjects) {
  if (!subjects.length) return 0;
  if (subjects.length === 1) {
    const s = subjects[0];
    return Math.round(100 * Math.max(0, 1 - Math.hypot(s.cx, s.cy) / MAX_CENTRE));
  }
  let sum = 0;
  for (const s of subjects) {
    let best = Infinity;
    for (const [tx, ty] of THIRDS) best = Math.min(best, Math.hypot(s.cx - tx, s.cy - ty));
    sum += Math.max(0, 1 - best / MAX_THIRD);
  }
  return Math.round((100 * sum) / subjects.length);
}

function bonusList(subjects) {
  const out = [];
  const colours = new Set(subjects.map((s) => s.colourIndex));
  if (colours.size >= 2) {
    out.push({ label: colours.size + ' colours', factor: colours.size });
  }
  if (colours.size === 6) {
    out.push({ label: 'RAINBOW', factor: 2, rainbow: true });
  }
  if (subjects.some((s) => s.adult) && subjects.some((s) => !s.adult)) {
    out.push({ label: 'foal + adult', factor: 2 });
  }
  return out;
}
