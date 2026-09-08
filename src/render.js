import { context, program, buffer, vao, dataTexture } from './gl.js';
import { perspective, view, multiply } from './mat.js';
import { WATER_Y } from './terrain.js';
import { buildModel, buildPoseTable, COLORS, PARTS, POSE_ROWS } from './unicorn.js';

const SKY = [0.62, 0.78, 0.95];

const FOG_DISTANCE = 190;

// Shared lighting: one sun plus distance fog into the sky colour. The terrain
// supplies smooth per-vertex normals; the unicorns take theirs from screen-space
// derivatives, which keeps them crisply faceted against the soft ground.
const SHADE = `vec3 shade(vec3 wp, vec3 n, vec3 base, vec3 eye, vec3 sky, float fog) {
  float l = 0.42 + 0.58 * max(0.0, dot(normalize(n), normalize(vec3(0.42, 0.82, 0.32))));
  float f = clamp(length(wp - eye) / fog, 0.0, 1.0);
  return mix(base * l, sky, f * f);
}
vec3 faceted(vec3 wp, vec3 eye) {
  vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
  return dot(n, eye - wp) < 0.0 ? -n : n;
}`;

const TERRAIN_VS = `#version 300 es
in vec3 p;
in vec4 c;
in vec4 nm;
uniform mat4 vp;
out vec3 wp;
out vec4 vc;
out vec3 vn;
void main() {
  wp = p;
  vc = c;
  vn = nm.xyz;
  gl_Position = vp * vec4(p, 1.0);
}`;

const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 wp;
in vec4 vc;
in vec3 vn;
uniform vec3 eye;
uniform vec3 sky;
uniform float fog;
uniform float idPass;
uniform vec2 sentinel;
out vec4 o;
${SHADE}
void main() {
  // In the ID pass the scenery paints a sentinel id rather than being masked
  // out. That is what lets one readback tell "hidden behind a hill" apart from
  // "against the sky" -- with the mask, both came back as zero.
  if (idPass > 0.5) { o = vec4(sentinel, clamp(length(wp - eye) / 256.0, 0.0, 1.0), 1.0); return; }
  o = vec4(shade(wp, vn, vc.rgb, eye, sky, fog), vc.a);
}`;

// One instanced draw for the whole herd. Each vertex names the body part it
// belongs to; the part's pose matrix is fetched from a lookup texture indexed by
// the instance's current animation frame.
const HERD_VS = `#version 300 es
in vec3 p;
in vec2 a;          // x: part index, y: colour role
in vec4 ip;         // world x, y, z, yaw
in vec4 iq;         // scale, colour index, pose row, spare
uniform mat4 vp;
uniform sampler2D poses;
uniform vec3 pal[6];
out vec3 wp;
out vec3 vc;
flat out int vid;

void main() {
  int part = int(a.x);
  int row = int(iq.z);
  mat4 m = mat4(
    texelFetch(poses, ivec2(part * 4, row), 0),
    texelFetch(poses, ivec2(part * 4 + 1, row), 0),
    texelFetch(poses, ivec2(part * 4 + 2, row), 0),
    texelFetch(poses, ivec2(part * 4 + 3, row), 0));
  int role = int(a.y);
  // Roles 4-6 are the extra horns; collapse them to a point unless this animal
  // has grown that many, which the rasteriser then drops as degenerate.
  vec3 local = (m * vec4(p, 1.0)).xyz * iq.x;
  if (role > 3 && float(role - 3) > iq.w) local = vec3(0.0);

  float s = sin(ip.w), co = cos(ip.w);
  wp = vec3(local.x * co + local.z * s, local.y, -local.x * s + local.z * co) + ip.xyz;

  int ci = int(iq.y);
  vc = role == 0 ? pal[ci]
     : role == 1 ? mix(pal[ci], vec3(1.0), 0.45)  // mane and tail: a lighter coat
     : role == 3 ? pal[ci] * 0.42                 // hooves and muzzle
     : vec3(0.98, 0.94, 0.78);                    // horns, however many
  vid = gl_InstanceID;
  gl_Position = vp * vec4(wp, 1.0);
}`;

const HERD_FS = `#version 300 es
precision highp float;
in vec3 wp;
in vec3 vc;
flat in int vid;
uniform vec3 eye;
uniform vec3 sky;
uniform float fog;
uniform float idPass;
out vec4 o;
${SHADE}
void main() {
  if (idPass > 0.5) {
    // Flat per-instance colour so a readback can measure each unicorn exactly.
    int id = vid + 1;
    o = vec4(float(id & 255) / 255.0, float((id >> 8) & 255) / 255.0,
             clamp(length(wp - eye) / 256.0, 0.0, 1.0), 1.0);
  } else {
    o = vec4(shade(wp, faceted(wp, eye), vc, eye, sky, fog), 1.0);
  }
}`;

export function createRenderer(canvas, world, herd) {
  const gl = context(canvas);

  // --- terrain + sea ---
  const tp = program(gl, TERRAIN_VS, TERRAIN_FS);
  const P = gl.getAttribLocation(tp, 'p'), C = gl.getAttribLocation(tp, 'c');
  const NM = gl.getAttribLocation(tp, 'nm');
  const terrain = vao(gl, [
    [P, buffer(gl, world.mesh.pos), 3, gl.FLOAT, false],
    [C, buffer(gl, world.mesh.col), 4, gl.UNSIGNED_BYTE, true],
    [NM, buffer(gl, world.mesh.nrm), 4, gl.BYTE, true],
  ]);
  const terrainIdx = gl.createBuffer();
  gl.bindVertexArray(terrain);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, world.mesh.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  // The track is its own ribbon, drawn over the carved roadbed. Culling is off
  // for it so a winding mistake can never make the path vanish.
  const trackVao = vao(gl, [
    [P, buffer(gl, world.trackMesh.pos), 3, gl.FLOAT, false],
    [C, buffer(gl, world.trackMesh.col), 4, gl.UNSIGNED_BYTE, true],
    [NM, buffer(gl, world.trackMesh.nrm), 4, gl.BYTE, true],
  ]);
  const trackIdx = gl.createBuffer();
  gl.bindVertexArray(trackVao);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, trackIdx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, world.trackMesh.idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);

  const N = world.N, wy = WATER_Y;
  const wPos = new Float32Array([0, wy, N, N, wy, N, N, wy, 0, 0, wy, N, N, wy, 0, 0, wy, 0]);
  const wCol = new Uint8Array(24);
  const wNrm = new Int8Array(24);
  for (let i = 0; i < 6; i++) { wCol.set([46, 108, 190, 165], i * 4); wNrm[i * 4 + 1] = 127; }
  const water = vao(gl, [
    [P, buffer(gl, wPos), 3, gl.FLOAT, false],
    [C, buffer(gl, wCol), 4, gl.UNSIGNED_BYTE, true],
    [NM, buffer(gl, wNrm), 4, gl.BYTE, true],
  ]);

  // --- herd ---
  const hp = program(gl, HERD_VS, HERD_FS);
  const model = buildModel();
  const instanceBuf = buffer(gl, herd.instances, gl.DYNAMIC_DRAW);
  const hPos = gl.getAttribLocation(hp, 'p'), hAttr = gl.getAttribLocation(hp, 'a');
  const hIp = gl.getAttribLocation(hp, 'ip'), hIq = gl.getAttribLocation(hp, 'iq');
  const modelBuf = buffer(gl, model.pos);
  const attrBuf = buffer(gl, model.attr);
  const herdVao = gl.createVertexArray();
  gl.bindVertexArray(herdVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, modelBuf);
  gl.enableVertexAttribArray(hPos);
  gl.vertexAttribPointer(hPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, attrBuf);
  gl.enableVertexAttribArray(hAttr);
  gl.vertexAttribPointer(hAttr, 2, gl.UNSIGNED_BYTE, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
  gl.enableVertexAttribArray(hIp);
  gl.vertexAttribPointer(hIp, 4, gl.FLOAT, false, 32, 0);
  gl.vertexAttribDivisor(hIp, 1);
  gl.enableVertexAttribArray(hIq);
  gl.vertexAttribPointer(hIq, 4, gl.FLOAT, false, 32, 16);
  gl.vertexAttribDivisor(hIq, 1);
  gl.bindVertexArray(null);

  // Thrown lures: a handful of little ground pyramids, rebuilt each frame with
  // the terrain program. An invisible mechanic is a broken one.
  const MAX_LURES = 12, LURE_VERTS = MAX_LURES * 12;
  const lurePos = new Float32Array(LURE_VERTS * 3);
  const lureCol = new Uint8Array(LURE_VERTS * 4);
  const lureNrm = new Int8Array(LURE_VERTS * 4);
  const lurePosBuf = buffer(gl, lurePos, gl.DYNAMIC_DRAW);
  const lureColBuf = buffer(gl, lureCol, gl.DYNAMIC_DRAW);
  const lureNrmBuf = buffer(gl, lureNrm, gl.DYNAMIC_DRAW);
  const lureVao = vao(gl, [
    [P, lurePosBuf, 3, gl.FLOAT, false],
    [C, lureColBuf, 4, gl.UNSIGNED_BYTE, true],
    [NM, lureNrmBuf, 4, gl.BYTE, true],
  ]);
  let lureCount = 0;

  function buildLures(lures, groundAt, time, gravity) {
    lureCount = Math.min(lures.length, MAX_LURES);
    for (let i = 0; i < lureCount; i++) {
      const l = lures[i];
      const c = l.strong ? [255, 240, 150] : [190, 235, 255];
      // The strong lure stands taller, so its reach reads from the cart.
      let h = l.strong ? 8 : 5;
      let y = groundAt(l.x, l.z) + 0.1;
      let x = l.x, z = l.z, r = 0.85;

      if (l.flying) {
        // The real trajectory, so what you watch is where it will land. Small in
        // the air so it reads as a thrown object, not the beacon it becomes.
        const t = l.flight * l.flightTime;
        x = l.fx + l.vx * t;
        z = l.fz + l.vz * t;
        y = l.fy + l.vy * t - 0.5 * gravity * t * t;
        h = 1.1;
        r = 0.35;
      }
      // Shrinks as it burns out, so its remaining life is visible on the lure.
      const life = l.life === undefined ? 1 : l.life;
      h *= 0.3 + 0.7 * life;
      const spin = time * 1.5 + i;
      for (let f = 0; f < 4; f++) {
        const a0 = spin + (f * Math.PI) / 2, a1 = a0 + Math.PI / 2;
        const v = (i * 12 + f * 3) * 3, k = (i * 12 + f * 3) * 4;
        const pts = [
          x, y + h, z,
          x + Math.cos(a0) * r, y, z + Math.sin(a0) * r,
          x + Math.cos(a1) * r, y, z + Math.sin(a1) * r,
        ];
        for (let q = 0; q < 9; q++) lurePos[v + q] = pts[q];
        for (let q = 0; q < 3; q++) {
          lureCol[k + q * 4] = c[0]; lureCol[k + q * 4 + 1] = c[1];
          lureCol[k + q * 4 + 2] = c[2]; lureCol[k + q * 4 + 3] = 255;
          lureNrm[k + q * 4] = Math.cos((a0 + a1) / 2) * 90;
          lureNrm[k + q * 4 + 1] = 80;
          lureNrm[k + q * 4 + 2] = Math.sin((a0 + a1) / 2) * 90;
        }
      }
    }
    if (!lureCount) return;
    const n3 = lureCount * 36, n4 = lureCount * 48;
    gl.bindBuffer(gl.ARRAY_BUFFER, lurePosBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lurePos, 0, n3);
    gl.bindBuffer(gl.ARRAY_BUFFER, lureColBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lureCol, 0, n4);
    gl.bindBuffer(gl.ARRAY_BUFFER, lureNrmBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, lureNrm, 0, n4);
  }

  const poseTex = dataTexture(gl, PARTS * 4, POSE_ROWS, buildPoseTable());
  const palette = new Float32Array(COLORS.flat());

  // w/h default to the canvas, but the photo rig renders the ID pass into a
  // small offscreen buffer at the same aspect, so it must pass its own.
  function draw(cam, fovy, idPass, w, h) {
    w = w || canvas.width;
    h = h || canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(idPass ? 0 : SKY[0], idPass ? 0 : SKY[1], idPass ? 0 : SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const vp = multiply(
      perspective(fovy, w / h, 0.1, 1200),
      view([cam.x, cam.y, cam.z], cam.yaw, cam.pitch)
    );

    gl.disable(gl.BLEND);
    gl.depthMask(true);

    // Terrain still draws during the ID pass so it occludes unicorns correctly;
    // it just writes the background colour.
    gl.useProgram(tp);
    gl.uniformMatrix4fv(tp.u.vp, false, vp);
    gl.uniform3f(tp.u.eye, cam.x, cam.y, cam.z);
    gl.uniform3fv(tp.u.sky, idPass ? [0, 0, 0] : SKY);
    gl.uniform1f(tp.u.fog, idPass ? 1e9 : FOG_DISTANCE);
    gl.uniform1f(tp.u.idPass, idPass ? 1 : 0);
    gl.uniform2f(tp.u.sentinel, 1, 1);          // 65535 = scenery
    gl.bindVertexArray(terrain);
    gl.drawElements(gl.TRIANGLES, world.mesh.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(trackVao);
    gl.drawElements(gl.TRIANGLES, world.trackMesh.count, gl.UNSIGNED_INT, 0);
    if (lureCount) {
      // Drawn in the ID pass too, so the scorer can see your bait in the shot.
      // Lures land at the fog limit, so at the scenery's fog setting the beacon
      // is washed to exactly the sky colour. It is a gameplay marker, not
      // scenery -- draw it unfogged so you can actually see where it went.
      gl.uniform1f(tp.u.fog, 1e9);
      gl.uniform2f(tp.u.sentinel, 254 / 255, 1); // 65534 = your own bait
      gl.bindVertexArray(lureVao);
      gl.drawArrays(gl.TRIANGLES, 0, lureCount * 12);
      gl.uniform1f(tp.u.fog, FOG_DISTANCE);
      gl.uniform2f(tp.u.sentinel, 1, 1);
    }
    gl.enable(gl.CULL_FACE);

    gl.useProgram(hp);
    gl.uniformMatrix4fv(hp.u.vp, false, vp);
    gl.uniform3f(hp.u.eye, cam.x, cam.y, cam.z);
    gl.uniform3fv(hp.u.sky, SKY);
    gl.uniform1f(hp.u.fog, FOG_DISTANCE);
    gl.uniform1f(hp.u.idPass, idPass ? 1 : 0);
    gl.uniform3fv(hp.u['pal[0]'] || hp.u.pal, palette);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, poseTex);
    gl.uniform1i(hp.u.poses, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, herd.instances);
    gl.bindVertexArray(herdVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, model.count, herd.n);

    if (!idPass) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.useProgram(tp);
      gl.bindVertexArray(water);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
    }
    gl.bindVertexArray(null);
  }

  return { gl, draw, buildLures };
}
