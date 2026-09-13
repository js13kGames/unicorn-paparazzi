// Replaces `gl.SOME_ENUM` with the number it is, at build time.
//
// Every WebGL enum is a plain numeric property fixed by the spec, so
// `gl.TEXTURE_MIN_FILTER` and `10241` are the same call -- but the name is 21
// characters and the number is five, and there are ~90 of them in src/.
//
// Terser will not do this itself. Its property mangler ships a built-in reserve
// list of DOM and WebGL property names, which beats the `/^.{3,}$/` regex in
// webpack.config.js -- correctly, since renaming `gl.TEXTURE_2D` to `gl.a`
// would break the call. The only way to get the bytes is to remove the property
// access entirely, which is what this does.
//
// The table below is the whole safety story, so the values are written in hex,
// exactly as the spec writes them, to be checked against it by eye. A
// `gl.<UPPER_CASE>` name that is NOT in the table throws: a wrong value would
// otherwise surface as a black frame rather than an exception, so an unknown
// enum must fail the build, not pass through.
const ENUMS = {
  ACTIVE_UNIFORMS: 0x8b86,
  ARRAY_BUFFER: 0x8892,
  BLEND: 0x0be2,
  BYTE: 0x1400,
  CLAMP_TO_EDGE: 0x812f,
  COLOR_ATTACHMENT0: 0x8ce0,
  COLOR_BUFFER_BIT: 0x4000,
  COMPILE_STATUS: 0x8b81,
  CULL_FACE: 0x0b44,
  DEPTH_ATTACHMENT: 0x8d00,
  DEPTH_BUFFER_BIT: 0x0100,
  DEPTH_COMPONENT16: 0x81a5,
  DEPTH_TEST: 0x0b71,
  DYNAMIC_DRAW: 0x88e8,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  FRAGMENT_SHADER: 0x8b30,
  FRAMEBUFFER: 0x8d40,
  LINK_STATUS: 0x8b82,
  NEAREST: 0x2600,
  ONE_MINUS_SRC_ALPHA: 0x0303,
  RENDERBUFFER: 0x8d41,
  RGBA: 0x1908,
  RGBA32F: 0x8814,
  SRC_ALPHA: 0x0302,
  STATIC_DRAW: 0x88e4,
  TEXTURE0: 0x84c0,
  TEXTURE_2D: 0x0de1,
  TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_MIN_FILTER: 0x2801,
  TEXTURE_WRAP_S: 0x2802,
  TEXTURE_WRAP_T: 0x2803,
  TRIANGLES: 0x0004,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  VERTEX_SHADER: 0x8b31,
};

module.exports = function glConstsLoader(source) {
  // Anchored on `gl.` because that is the only object in src/ carrying
  // SHOUTING_CASE properties (the one other uppercase access anywhere is
  // webpack's own `env.NODE_ENV`), which makes the rewrite unambiguous.
  return source.replace(/\bgl\.([A-Z][A-Z0-9_]+)\b/g, (whole, name) => {
    if (!(name in ENUMS)) {
      throw new Error('gl-consts: unknown WebGL enum ' + whole + '; add it to the table with its spec value');
    }
    return String(ENUMS[name]);
  });
};

module.exports.ENUMS = ENUMS;
