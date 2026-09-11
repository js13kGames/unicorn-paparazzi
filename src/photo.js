// Taking a photograph is two renders. The visible one becomes the thumbnail the
// player reviews; a second pass into a small offscreen buffer paints each
// unicorn in a flat color keyed to its instance id, and reading that back gives
// -- exactly, and with correct occlusion -- who is in frame, how much of the
// frame each one fills, whether any is clipped by an edge, and where its centre
// of mass sits. Every term in the scoring rubric falls out of that one buffer.

// The photograph is a fixed shape whatever the window is doing. It used to
// follow the canvas, which meant the same shot scored twice as much in a
// half-width window: vertical fov is fixed, so a subject's pixels track the
// buffer HEIGHT while the frame area is width x height, and coverage came out
// proportional to 1/aspect.
export const PHOTO_ASPECT = 16 / 9;
// Exactly 16:9, which no integer width at the old 240 could be. readPixels at
// real photo resolution would stall for 100ms+.
const ID_W = 384, ID_H = 216;
// Big enough to be worth downloading, small enough that a 50-shot roll is a few
// megabytes. The film roll and results list scale the same image down in CSS, so
// one canvas serves the preview and the saved file.
const THUMB_H = 900;
// What goes over the relay. The results screen shows a rival's shot at card
// width, so 320x180 was being upscaled 2x and looked it. Measured at ~24KB of
// base64 at this size and quality, against a relay verified to pass 128KB.
const WIRE_H = 540;

// How much of the screen the frame takes. One value for every camera: it used to
// climb with the sensor tier and reached the whole screen at the top, which left
// the best camera in the game with no margin to see a unicorn coming.
export const FRAME_SHARE = 0.7;

// The photograph's own vertical fov is the real one; the screen shows that
// frustum plus the frame's margin, and opens up further when the window is
// narrower than the photograph, so the whole frame always stays on screen.
// fx/fy are the frame's share of the canvas: viewfinder outline and thumbnail
// source rectangle both come from them.
export function frame(fovy, winAspect) {
  const tp = Math.tan(fovy / 2);
  const ts = tp * Math.max(1 / FRAME_SHARE, PHOTO_ASPECT / winAspect);
  const fy = tp / ts;
  return { fov: 2 * Math.atan(ts), fy, fx: (fy * PHOTO_ASPECT) / winAspect };
}

export function createPhotoRig(gl, canvas, draw) {
  const tex = gl.createTexture();
  const depth = gl.createRenderbuffer();
  const fbo = gl.createFramebuffer();
  const pixels = new Uint8Array(ID_W * ID_H * 4);

  const thumb = document.createElement('canvas');
  thumb.width = Math.round(THUMB_H * PHOTO_ASPECT);
  thumb.height = THUMB_H;
  const tctx = thumb.getContext('2d');

  // A second, tiny copy of every shot, encoded once at capture time because the
  // thumb canvas is overwritten by the next photograph. Only the best one is ever
  // sent, but by then the pixels are long gone.
  const wire = document.createElement('canvas');
  wire.width = Math.round(WIRE_H * PHOTO_ASPECT);
  wire.height = WIRE_H;
  const wctx = wire.getContext('2d');

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ID_W, ID_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, ID_W, ID_H);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Must run inside the same frame as the visible draw, while the drawing buffer
  // is still intact -- that is what lets us skip preserveDrawingBuffer.
  //
  // fx/fy locate the frame within the canvas, so the thumbnail is cut from
  // exactly the rectangle the viewfinder was outlining. The ID pass renders the
  // photo's own frustum, so it needs no crop at all: the buffer IS the
  // photograph, and nothing about it depends on the window.
  // `res` is the camera tier, and it sets the JPEG quality: the cheap camera
  // develops a heavily compressed photograph. Cosmetic by construction -- the ID
  // pass below reads the GL buffer, never the JPEG, so no score can move.
  function capture(cam, fovy, herd, fx, fy, res, mp) {
    const cw = canvas.width * fx, ch = canvas.height * fy;
    tctx.drawImage(canvas, (canvas.width - cw) / 2, (canvas.height - ch) / 2, cw, ch,
                   0, 0, thumb.width, thumb.height);
    const url = thumb.toDataURL('image/jpeg', [.05, .3, .6, .9][res]);
    // The 540p copy exists only to fit on the wire. Solo play never sends one,
    // and a second JPEG encode per shot is real work on a phone.
    let small = '';
    if (mp) {
      wctx.drawImage(thumb, 0, 0, wire.width, wire.height);
      small = wire.toDataURL('image/jpeg', 0.8);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    draw(cam, fovy, true, ID_W, ID_H);
    gl.readPixels(0, 0, ID_W, ID_H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const subjects = tally(pixels, ID_W, ID_H, herd);
    return { url, small, w: ID_W, h: ID_H, subjects };
  }

  return { capture };
}

// Walk the ID buffer once, accumulating per-unicorn pixel count, bounding box
// and centroid. Pose, color and age are snapshotted here because the herd keeps
// moving while the photos wait to be scored.
// Scenery's sentinel id. The herd is a few hundred animals, so real ids never
// come near it.
export const TERRAIN = 65535;
// Blue carries distance/256, so one step is about a unit. A neighbour only
// counts as occluding if it is genuinely nearer -- a unicorn always borders the
// ground it is standing on, and the gaps between its legs are all terrain, so
// bare contact says nothing.
const NEARER = 2;
// What a head pixel is worth against a flank pixel when the outline is measured.
// A unicorn cut off at the neck, or standing behind a rock that hides its face,
// is a worse photograph than the same animal missing a hindquarter -- so the
// head and the horn count for more of the outline, in both directions: they
// raise the penalty when they are the part that is cut, and they raise the
// denominator, so losing a flank instead now costs slightly less than it did.
const HEAD_W = 3;

export function tally(px, W, H, herd, rect) {
  const r = rect || { x0: 0, y0: 0, w: W, h: H };
  const x1 = r.x0 + r.w, y1 = r.y0 + r.h;
  const at = (x, y) => { const o = (y * W + x) * 4; return px[o] | (px[o + 1] << 8); };
  const depth = (x, y) => px[(y * W + x) * 4 + 2];
  const seen = new Map();
  for (let y = r.y0; y < y1; y++) {
    for (let x = r.x0; x < x1; x++) {
      const o = (y * W + x) * 4;
      const id = px[o] | (px[o + 1] << 8);
      if (!id || id === TERRAIN) continue;
      const cx = x - r.x0, cy = y - r.y0;
      let s = seen.get(id);
      if (!s) {
        const i = id - 1;
        s = {
          n: 0, minx: r.w, maxx: -1, miny: r.h, maxy: -1, sx: 0, sy: 0,
          outline: 0, edge: 0, env: 0, occ: 0,
          color: herd.color[i], pose: herd.pose[i], horns: herd.horns[i],
        };
        seen.set(id, s);
      }
      s.n++;
      // Alpha carries the head flag out of the ID pass.
      const hw = px[o + 3] > 127 ? HEAD_W : 1;
      s.sx += cx; s.sy += cy;
      if (cx < s.minx) s.minx = cx;
      if (cx > s.maxx) s.maxx = cx;
      if (cy < s.miny) s.miny = cy;
      if (cy > s.maxy) s.maxy = cy;

      // Walk the four neighbours. Every crossing out of this subject is a piece
      // of its outline, and what sits on the other side says why it is cut:
      // off the edge of the photograph, behind scenery, or behind another
      // unicorn. Cropping and both occlusions are the same measurement.
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < r.x0 || nx >= x1 || ny < r.y0 || ny >= y1) { s.outline += hw; s.edge += hw; continue; }
        const b = at(nx, ny);
        if (b === id) continue;
        s.outline += hw;
        if (!b || depth(nx, ny) > depth(x, y) - NEARER) continue;   // sky, or behind
        if (b === TERRAIN) s.env += hw;
        else s.occ += hw;
      }
    }
  }
  return seen;
}
