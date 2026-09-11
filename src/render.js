import { context, program, buffer, vao, dataTexture } from './gl.js';
import { perspective, view, multiply } from './mat.js';
import { WATER_Y } from './terrain.js';
import { buildModel, buildPoseTable, COLORS, PARTS, POSE_ROWS } from './unicorn.js';

const SKY = [0.62, 0.78, 0.95];

const FOG_DISTANCE = 190;

// Shared lighting: one sun plus distance fog into the sky color. The terrain
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
in vec2 a;          // x: part index, y: color role
in vec4 ip;         // world x, y, z, yaw
in vec4 iq;         // scale, color index, pose row, spare
uniform mat4 vp;
uniform sampler2D poses;
uniform vec3 pal[6];
out vec3 wp;
out vec3 vc;
flat out int vid;
// Head and horn, for the ID pass: alpha there was a constant 1.0 doing nothing,
// and the scoring wants to know which end of the animal got cut off.
flat out float vh;

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
  vh = float(part == 2 || part == 3);
  gl_Position = vp * vec4(wp, 1.0);
}`;

const HERD_FS = `#version 300 es
precision highp float;
in vec3 wp;
in vec3 vc;
flat in int vid;
flat in float vh;
uniform vec3 eye;
uniform vec3 sky;
uniform float fog;
uniform float idPass;
out vec4 o;
${SHADE}
void main() {
  if (idPass > 0.5) {
    // Flat per-instance color so a readback can measure each unicorn exactly.
    int id = vid + 1;
    o = vec4(float(id & 255) / 255.0, float((id >> 8) & 255) / 255.0,
             clamp(length(wp - eye) / 256.0, 0.0, 1.0), vh);
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
  // Every vertex of the sea shares one colour and one normal, so it carries
  // neither. An attribute whose array is switched off in this VAO reads the
  // context's constant for that slot instead, and those two constants are set
  // once here: the terrain's own buffers stay bound to the same slots in its
  // own VAO, and nothing else ever looks at them.
  const water = vao(gl, [[P, buffer(gl, wPos), 3, gl.FLOAT, false]]);
  gl.vertexAttrib4f(C, 46 / 255, 108 / 255, 190 / 255, 165 / 255);
  gl.vertexAttrib4f(NM, 0, 1, 0, 0);

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

    // Terrain still draws during the ID pass so it occludes unicorns correctly;
    // it just writes the background color.
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
    gl.enable(gl.CULL_FACE);

    // The sea is one flat quad, drawn here while the terrain program and its
    // uniforms are still current -- so it costs a bind and a draw and nothing
    // else. TERRAIN_FS already writes vc.a, and the quad's colour is a constant
    // vertex attribute, so the translucency is just the alpha it is set with:
    // everything below is the depth-mask dance around it, which is what stops a
    // surface that does not occlude from writing depth as if it did.
    //
    // It does NOT need a pass of its own at the end of the frame, which is what
    // it used to have. Nothing is ever drawn between the eye and the surface: no
    // unicorn spawns in the sea, and the eye rides 2.4 above the rails, so no
    // ray to an animal crosses the plane. Skipped in the ID pass, where the sea
    // is not a subject and the sea floor is the thing being measured.
    if (!idPass) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.bindVertexArray(water);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

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

    gl.bindVertexArray(null);
  }

  return { gl, draw };
}
