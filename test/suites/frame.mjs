// The photograph must not depend on the window.
//
// It used to. The projection fixes the VERTICAL fov, so a subject's pixels track
// the buffer height while the frame area is width x height -- coverage came out
// proportional to 1/aspect, and since size is coverage x resBonus, the same shot
// scored twice as much in a half-width window. These checks pin the geometry
// that replaced it, and then prove the ID pass itself no longer looks at the
// canvas at all.

const ctx = { drawImage() {} };
// createPhotoRig makes two canvases: the full thumbnail, then the small copy that
// goes over the relay. Only the first one's quality tracks the camera tier.
const jpeg = [];
let made = 0;
globalThis.document = {
  createElement: () => {
    const isThumb = made++ % 2 === 0;
    return {
      getContext: () => ctx, width: 0, height: 0,
      toDataURL: (t, q) => { if (isThumb) jpeg.push(q); return 'data:image/jpeg;base64,x'; },
    };
  },
};

const { frame, PHOTO_ASPECT, FRAME_SHARE, createPhotoRig } = await import('../.mirror/photo.mjs');

let fails = 0;
const check = (name, got, want, tol = 0) => {
  const ok = typeof got === 'number' && typeof want === 'number'
    ? Math.abs(got - want) <= tol : got === want;
  if (!ok) fails++;
  console.log((ok ? '  ok  ' : 'FAIL  ') + name.padEnd(52), String(got).padStart(8),
              ok ? '' : '(expected ' + want + (tol ? ' ±' + tol : '') + ')');
};

const FOV = Math.PI / 3;
// 16:10 is the laptop shape that exposed the old top tier having no margin.
const ASPECTS = [4 / 3, 16 / 10, 16 / 9, 21 / 9, 9 / 16, 3.9, 1];
// Wider than this and the frame share is what limits the frame; narrower and the
// window is, which is the only case where the frame may touch an edge.
const BINDS = PHOTO_ASPECT * FRAME_SHARE;

// --- the frame is always 16:9, whatever the window is ---
for (const a of ASPECTS) {
  const f = frame(FOV, a);
  // In pixels: (fx * W) / (fy * H) where W/H is the window aspect.
  check('window ' + a.toFixed(2) + ': frame is 16:9', (f.fx * a) / f.fy, PHOTO_ASPECT, 1e-9);
  check('window ' + a.toFixed(2) + ': frame fits on screen', f.fx <= 1 && f.fy <= 1, true);
}

// --- the constrained axis touches the edge, so no view is wasted ---
{
  // Window narrower than 16:9: the frame is limited by width.
  const tall = frame(FOV, 9 / 16);
  check('a window narrower than the photo fills its width', tall.fx, 1, 1e-9);
  check('and gives up height to do it', tall.fy < FRAME_SHARE, true);
  // Window wider than 16:9: the frame's own share is what limits it.
  const wide = frame(FOV, 21 / 9);
  check('a wide window is limited by the frame share, not the window', wide.fy, FRAME_SHARE, 1e-9);
}

// --- one frame share for every camera, and it always leaves a margin ---
// The share used to climb with the sensor tier and reach 1.0 at the top, so the
// best camera in the game had no margin at all: the viewfinder outline sat on the
// screen edge and you could not see a unicorn coming. It is a constant now, which
// also means the frame does not move when you buy a camera.
{
  for (const a of ASPECTS) {
    const f = frame(FOV, a);
    const w = 'window ' + a.toFixed(2) + ': ';
    if (a > BINDS) {
      check(w + 'the frame takes its fixed share', f.fy, FRAME_SHARE, 1e-9);
      check(w + 'and leaves a margin on both axes', f.fx < 1 && f.fy < 1, true);
    } else {
      // Too narrow to fit the share: the window limits it and the frame fills
      // the width exactly, which is the correct thing to do with the space.
      check(w + 'a window this narrow limits the frame instead', f.fx, 1, 1e-9);
    }
  }
}

// --- the screen always contains the frame ---
// Every extra degree the screen opens up is world you can see but will not
// photograph, so the screen fov must never be narrower than the photo's.
for (const a of ASPECTS) {
  const f = frame(FOV, a);
  check('window ' + a.toFixed(2) + ': screen shows at least the frame', f.fov >= FOV - 1e-12, true);
}

// --- and the part that actually matters: the ID pass ignores the canvas ---
// capture() renders the photo's own frustum into a fixed buffer. Drive it with
// wildly different canvas sizes and the draw call must not change.
{
  const calls = [];
  const gl = new Proxy({}, {
    get: (_, k) => {
      if (k === 'readPixels') return () => {};
      return () => {};
    },
  });
  const canvas = { width: 0, height: 0 };
  const draw = (cam, fovy, idPass, w, h) => calls.push([fovy, idPass, w, h]);
  const rig = createPhotoRig(gl, canvas, draw);
  const herd = { coat: [], stance: [], horns: [] };

  const cam = { x: 0, y: 0, z: 0, yaw: 0, tilt: 0 };
  const shapes = [[3840, 2160], [800, 1600], [2560, 1080], [1024, 768]];
  for (const [w, h] of shapes) {
    canvas.width = w; canvas.height = h;
    const f = frame(FOV, w / h);
    rig.capture(cam, FOV, herd, f.fx, f.fy);
  }
  const uniq = new Set(calls.map((c) => c.join(',')));
  console.log('        ID pass draw args: ' + [...uniq].join('  |  '));
  check('the ID pass renders identically at every window size', uniq.size, 1);
  check('and renders the photo fov, not the screen fov', calls[0][0], FOV);
  check('into a 16:9 buffer', calls[0][2] / calls[0][3], PHOTO_ASPECT, 1e-9);

  // The camera tier develops a more compressed photograph, and that is the whole
  // of its cosmetic effect: the ID pass reads the GL buffer, never the JPEG, so
  // the draw args above must not move while the quality does.
  canvas.width = 1920; canvas.height = 1080;
  jpeg.length = 0;
  const before = new Set(calls.map((c) => c.join(',')));
  for (let r = 0; r < 4; r++) rig.capture(cam, FOV, herd, 1, 1, r);
  console.log('        jpeg quality per tier: ' + jpeg.join(' / '));
  check('a better camera develops a better jpeg',
        jpeg.every((q, i) => i === 0 || q > jpeg[i - 1]), true);
  check('the cheapest camera is heavily compressed', jpeg[0], 0.05, 1e-9);
  check('and the best one is not', jpeg[3], 0.9, 1e-9);
  check('quality never reaches the scoring pass',
        new Set(calls.map((c) => c.join(','))).size, before.size);
}

console.log(fails ? '\n' + fails + ' FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
