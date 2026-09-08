// Taking a photograph is two renders. The visible one becomes the thumbnail the
// player reviews; a second pass into a small offscreen buffer paints each
// unicorn in a flat colour keyed to its instance id, and reading that back gives
// -- exactly, and with correct occlusion -- who is in frame, how much of the
// frame each one fills, whether any is clipped by an edge, and where its centre
// of mass sits. Every term in the scoring rubric falls out of that one buffer.

const ID_HEIGHT = 240;   // readPixels at photo resolution would stall for 100ms+
const THUMB_HEIGHT = 180;

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
  function capture(cam, fovy, herd) {
    resize(canvas.width / canvas.height);
    tctx.drawImage(canvas, 0, 0, thumb.width, thumb.height);
    const url = thumb.toDataURL('image/jpeg', 0.72);

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    draw(cam, fovy, true, idW, idH);
    gl.readPixels(0, 0, idW, idH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return { url, w: idW, h: idH, subjects: tally(pixels, idW, idH, herd) };
  }

  return { capture };
}

// Walk the ID buffer once, accumulating per-unicorn pixel count, bounding box
// and centroid. Pose, colour and age are snapshotted here because the herd keeps
// moving while the photos wait to be scored.
export function tally(px, W, H, herd) {
  const seen = new Map();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const id = px[o] | (px[o + 1] << 8);
      if (!id) continue;
      let s = seen.get(id);
      if (!s) {
        const i = id - 1;
        s = {
          n: 0, minx: W, maxx: -1, miny: H, maxy: -1, sx: 0, sy: 0,
          color: herd.color[i], adult: herd.adult[i], pose: herd.pose[i],
        };
        seen.set(id, s);
      }
      s.n++;
      s.sx += x; s.sy += y;
      if (x < s.minx) s.minx = x;
      if (x > s.maxx) s.maxx = x;
      if (y < s.miny) s.miny = y;
      if (y > s.maxy) s.maxy = y;
    }
  }
  return seen;
}
