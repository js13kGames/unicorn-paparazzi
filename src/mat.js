// Only the matrix math the camera needs. Column-major, WebGL layout.

export function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

export function multiply(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
  }
  return o;
}

// Yaw 0 / pitch 0 looks down -Z. Returns the world->view matrix.
export function view(eye, yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const zx = sy * cp, zy = -sp, zz = cy * cp;   // backward
  const xx = cy, xy = 0, xz = -sy;              // right
  const ux = sp * sy, uy = cp, uz = sp * cy;    // up
  return new Float32Array([
    xx, ux, zx, 0,
    xy, uy, zy, 0,
    xz, uz, zz, 0,
    -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
    -(ux * eye[0] + uy * eye[1] + uz * eye[2]),
    -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
    1,
  ]);
}
