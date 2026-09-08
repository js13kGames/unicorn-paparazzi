// Taking a photograph is two renders. The visible one becomes the thumbnail the
// player reviews; a second pass into a small offscreen buffer paints each
// unicorn in a flat colour keyed to its instance id, and reading that back gives
// -- exactly, and with correct occlusion -- who is in frame, how much of the
// frame each one fills, whether any is clipped by an edge, and where its centre
// of mass sits. Every term in the scoring rubric falls out of that one buffer.

const ID_HEIGHT = 240;   // readPixels at photo resolution would stall for 100ms+
// Big enough to be worth downloading, small enough that a 50-shot roll is a few
// megabytes. The film roll and results list scale the same image down in CSS, so
// one canvas serves the preview and the saved file.
const THUMB_HEIGHT = 900;

export function createPhotoRig(gl, canvas, draw) {
  const tex = gl.createTexture();
  const depth = gl.createRenderbuffer();
  const fbo = gl.createFramebuffer();
  let idW = 0, idH = ID_HEIGHT, pixels = null;

  const thumb = document.createElement('canvas');
  const tctx = thumb.getContext('2d');

  // The ID buffer must frame identically to what the player saw, so it tracks
  // the canvas aspect rather than a fixed 16:9.
  function resize(aspect) {
    const w = Math.max(120, Math.min(854, Math.round(ID_HEIGHT * aspect)));
    if (w === idW) return;
    idW = w;
    pixels = new Uint8Array(idW * idH * 4);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, idW, idH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, idW, idH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    thumb.height = THUMB_HEIGHT;
    thumb.width = Math.round(THUMB_HEIGHT * aspect);
  }

  // Must run inside the same frame as the visible draw, while the drawing buffer
  // is still intact -- that is what lets us skip preserveDrawingBuffer.
  //
  // `crop` is the sensor's linear share of the screen: a cheap camera photographs
  // a small rectangle out of the middle of what you can see, a good one takes the
  // lot. The ID pass still renders the whole canvas and the crop is applied when
  // tallying, so one framebuffer serves every tier.
  function capture(cam, fovy, herd, crop) {
    resize(canvas.width / canvas.height);

    const cw = canvas.width * crop, ch = canvas.height * crop;
    tctx.drawImage(canvas, (canvas.width - cw) / 2, (canvas.height - ch) / 2, cw, ch,
                   0, 0, thumb.width, thumb.height);
    const url = thumb.toDataURL('image/jpeg', 0.85);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    draw(cam, fovy, true, idW, idH);
    gl.readPixels(0, 0, idW, idH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const rw = Math.round(idW * crop), rh = Math.round(idH * crop);
    const rect = {
      x0: Math.round((idW - rw) / 2), y0: Math.round((idH - rh) / 2), w: rw, h: rh,
    };
    const subjects = tally(pixels, idW, idH, herd, rect);
    return { url, w: rw, h: rh, subjects, bait: subjects.bait };
  }

  return { capture };
}

// Walk the ID buffer once, accumulating per-unicorn pixel count, bounding box
// and centroid. Pose, colour and age are snapshotted here because the herd keeps
// moving while the photos wait to be scored.
// Scenery's sentinel id. The herd is a few hundred animals, so real ids never
// come near it.
export const TERRAIN = 65535;
export const LURE = 65534;
// A stray pixel of bait should not cost 200 points; this is a visible lure.
const LURE_FLOOR = 0.0004;
// Blue carries distance/256, so one step is about a unit. A neighbour only
// counts as occluding if it is genuinely nearer -- a unicorn always borders the
// ground it is standing on, and the gaps between its legs are all terrain, so
// bare contact says nothing.
const NEARER = 2;

export function tally(px, W, H, herd, rect) {
  const r = rect || { x0: 0, y0: 0, w: W, h: H };
  const x1 = r.x0 + r.w, y1 = r.y0 + r.h;
  const at = (x, y) => { const o = (y * W + x) * 4; return px[o] | (px[o + 1] << 8); };
  const depth = (x, y) => px[(y * W + x) * 4 + 2];
  const seen = new Map();
  let bait = 0;
  for (let y = r.y0; y < y1; y++) {
    for (let x = r.x0; x < x1; x++) {
      const o = (y * W + x) * 4;
      const id = px[o] | (px[o + 1] << 8);
      if (id === LURE) { bait++; continue; }
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
        if (nx < r.x0 || nx >= x1 || ny < r.y0 || ny >= y1) { s.outline++; s.edge++; continue; }
        const b = at(nx, ny);
        if (b === id) continue;
        s.outline++;
        if (!b || depth(nx, ny) > depth(x, y) - NEARER) continue;   // sky, or behind
        if (b === TERRAIN) s.env++;
        else s.occ++;
      }
    }
  }
  seen.bait = bait / (r.w * r.h) >= LURE_FLOOR;
  return seen;
}
