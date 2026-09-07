import { context, program, buffer, vao } from './gl.js';
import { perspective, view, multiply } from './mat.js';
import { HEIGHT, WATER_Y } from './terrain.js';

export const SKY = [0.62, 0.78, 0.95];
const FOG_DISTANCE = 190;

const VS = `#version 300 es
in vec3 p;
in vec4 c;
uniform mat4 vp;
out vec3 wp;
out vec4 vc;
void main() {
  wp = p;
  vc = c;
  gl_Position = vp * vec4(p, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 wp;
in vec4 vc;
uniform vec3 eye;
uniform vec3 sky;
uniform float fog;
out vec4 o;
void main() {
  // Flat shading straight from screen-space derivatives: no normal attribute.
  vec3 n = normalize(cross(dFdx(wp), dFdy(wp)));
  if (dot(n, eye - wp) < 0.0) n = -n;
  float l = 0.42 + 0.58 * max(0.0, dot(n, normalize(vec3(0.42, 0.82, 0.32))));
  float d = length(wp - eye);
  float f = clamp(d / fog, 0.0, 1.0);
  o = vec4(mix(vc.rgb * l, sky, f * f), vc.a);
}`;

export function createRenderer(canvas, world) {
  const gl = context(canvas);
  const prog = program(gl, VS, FS);
  const P = gl.getAttribLocation(prog, 'p'), C = gl.getAttribLocation(prog, 'c');

  const terrain = vao(gl, [
    [P, buffer(gl, world.mesh.pos), 3, gl.FLOAT, false],
    [C, buffer(gl, world.mesh.col), 4, gl.UNSIGNED_BYTE, true],
  ]);

  // One translucent quad across the whole map for the sea surface.
  const N = world.N, y = WATER_Y;
  const wPos = new Float32Array([0, y, N, N, y, N, N, y, 0, 0, y, N, N, y, 0, 0, y, 0]);
  const wCol = new Uint8Array(6 * 4);
  for (let i = 0; i < 6; i++) wCol.set([46, 108, 190, 165], i * 4);
  const water = vao(gl, [
    [P, buffer(gl, wPos), 3, gl.FLOAT, false],
    [C, buffer(gl, wCol), 4, gl.UNSIGNED_BYTE, true],
  ]);

  function draw(cam, fovy) {
    const w = canvas.width, h = canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(SKY[0], SKY[1], SKY[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const vp = multiply(
      perspective(fovy, w / h, 0.1, 1200),
      view([cam.x, cam.y, cam.z], cam.yaw, cam.pitch)
    );

    gl.useProgram(prog);
    gl.uniformMatrix4fv(prog.u.vp, false, vp);
    gl.uniform3f(prog.u.eye, cam.x, cam.y, cam.z);
    gl.uniform3fv(prog.u.sky, SKY);
    gl.uniform1f(prog.u.fog, FOG_DISTANCE);

    gl.disable(gl.BLEND);
    gl.depthMask(true);
    gl.bindVertexArray(terrain);
    gl.drawArrays(gl.TRIANGLES, 0, world.mesh.count);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.bindVertexArray(water);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.depthMask(true);
    gl.bindVertexArray(null);
  }

  return { gl, draw };
}
