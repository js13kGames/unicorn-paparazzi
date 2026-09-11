// Strips comments and indentation out of GLSL template literals at build time.
//
// Terser never looks inside a string, so without this every shader comment and
// every space of shader indentation is shipped to the player. Doing it here
// rather than in the source keeps src/render.js readable, and doing it at build
// time rather than at load actually removes the bytes from the bundle.
module.exports = function glslLoader(source) {
  return source.replace(/`([^`]*)`/g, (whole, body) => {
    if (!/#version|vec3 /.test(body)) return whole;
    const out = body
      .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
      .replace(/\/\/[^\n]*/g, '')      // comments
      .replace(/[ \t]*\n[ \t]*/g, '\n') // indentation
      .replace(/\n{2,}/g, '\n')         // blank lines between blocks
      .trim()
      // Whitespace around punctuation. A GLSL tokeniser splits `return-x` the
      // same way it splits `return -x`, so this is safe everywhere except where
      // it would fuse two signs into `++` or `--`, which mean something else
      // entirely -- so that case is put back. Preprocessor lines are left alone:
      // `#version 300 es` needs both of its spaces.
      .split('\n')
      .map((l) => (l[0] === '#' ? l
        : l.replace(/\s*([-+*/%<>=!&|^?:;,(){}[\]])\s*/g, '$1')
           .replace(/([-+])\1/g, '$1 $1')))
      .join('\n');
    return '`' + out + '`';
  });
};
