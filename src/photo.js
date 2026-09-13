// Taking a photograph is two renders: the visible one becomes the thumbnail, and a
// second pass into a small offscreen buffer paints each unicorn in a flat colour
// keyed to its instance id. Reading that back gives -- exactly, and with correct
// occlusion -- who is in frame, how much of it each fills, what is clipped, and
// where each centre of mass sits. Every scoring term falls out of that buffer.

// Fixed shape whatever the window does. Following the canvas made the same shot
// score twice as much in a half-width window: vertical fov is fixed, so a
// subject's pixels track HEIGHT while frame area is width x height.
export const PHOTO_ASPECT = 16 / 9;
// Exactly 16:9. readPixels at real photo resolution would stall for 100ms+.
const ID_W = 384, ID_H = 216;
// One canvas serves preview and saved file; the roll scales it down in CSS.
const THUMB_H = 900;
// What goes over the relay: ~24KB of base64 at this size and quality, against a
// relay verified to pass 128KB. 320x180 was upscaled 2x on the card and looked it.
const WIRE_H = 540;

// How much of the screen the frame takes. One value for every camera -- climbing
// with the sensor left the best camera with no margin to see a unicorn coming.
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

  // Encoded at capture time because the thumb canvas is overwritten by the next
  // shot: only the best is ever sent, and by then those pixels are gone.
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

  // Must run in the same frame as the visible draw, while the drawing buffer is
  // intact -- that is what lets us skip preserveDrawingBuffer.
  //
  // fx/fy cut the thumbnail from exactly the rectangle the viewfinder outlined.
  // The ID pass renders the photo's own frustum, so it needs no crop: that buffer
  // IS the photograph. `res` sets JPEG quality only -- scoring reads the GL
  // buffer, never the JPEG, so no score can move.
  function capture(cam, fovy, herd, fx, fy, res, mp) {
    const cw = canvas.width * fx, ch = canvas.height * fy;
    tctx.drawImage(canvas, (canvas.width - cw) / 2, (canvas.height - ch) / 2, cw, ch,
                   0, 0, thumb.width, thumb.height);
    const pic = thumb.toDataURL('image/jpeg', [.15, .3, .6, .9][res]);
    // Solo never sends one, and a second JPEG encode per shot is real work on a
    // phone.
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
    return { pic, small, w: ID_W, h: ID_H, subjects };
  }

  return { capture };
}

// Walk the ID buffer once, accumulating per-unicorn pixel count, bounding box and
// centroid. Pose and colour are snapshotted here because the herd keeps moving
// while the photos wait to be scored.

// Scenery's sentinel id; real ids never come near it.
export const TERRAIN = 65535;
// Blue carries distance/256, so one step is about a unit. A neighbour occludes
// only if genuinely nearer: an animal always borders the ground it stands on.
const NEARER = 2;
// What a head pixel is worth against a flank pixel in the outline. Cut off at the
// neck is a worse photograph than missing a hindquarter. It weights both the
// penalty and the denominator, so losing a flank costs a little less.
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
          nx: 0, ny: 0, nn: 0,
          rim: 0, edge: 0, env: 0, occ: 0,
          coat: herd.coat[i], stance: herd.stance[i], horns: herd.horns[i],
        };
        seen.set(id, s);
      }
      s.n++;
      // Alpha carries the part out of the ID pass: 255 head or horn, 102 neck.
      const a = px[o + 3];
      const hw = a > 127 ? HEAD_W : 1;
      // Framing is measured from the neck, so it gets its own centroid; the
      // whole-body one is the fallback when the neck is hidden.
      if (a > 50 && a < 180) { s.nx += cx; s.ny += cy; s.nn++; }
      s.sx += cx; s.sy += cy;
      if (cx < s.minx) s.minx = cx;
      if (cx > s.maxx) s.maxx = cx;
      if (cy < s.miny) s.miny = cy;
      if (cy > s.maxy) s.maxy = cy;

      // Every crossing out of this subject is a piece of its outline, and what sits
      // on the other side says why: the frame edge, scenery, or another unicorn.
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? -1 : k === 1 ? 1 : 0);
        const ny = y + (k === 2 ? -1 : k === 3 ? 1 : 0);
        if (nx < r.x0 || nx >= x1 || ny < r.y0 || ny >= y1) { s.rim += hw; s.edge += hw; continue; }
        const b = at(nx, ny);
        if (b === id) continue;
        s.rim += hw;
        if (!b || depth(nx, ny) > depth(x, y) - NEARER) continue;   // sky, or behind
        if (b === TERRAIN) s.env += hw;
        else s.occ += hw;
      }
    }
  }
  return seen;
}
