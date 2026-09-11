// Strips comments and indentation out of GLSL template literals at build time.
//
// Terser never looks inside a string, so without this every shader comment and
// every space of shader indentation is shipped to the player. Doing it here
// rather than in the source keeps src/render.js readable, and doing it at build
// time rather than at load actually removes the bytes from the bundle.
// Shader-local names, shortened on the way out. Only things GLSL resolves for
// itself go here: function names, their parameters, and locals. Uniforms and
// attributes must never be listed -- JavaScript binds those by string, and
// build/check-shaders.mjs compares the names it binds against the names that
// survive this file, so a mistake here fails the build rather than the frame.
// A varying would be safe (both halves are renamed together) but is not worth
// the line: they are all one or two characters already.
const LOCALS = {
  shade: 'S', faceted: 'F', base: 'b', part: 'q', row: 'r', role: 'e', local: 'L',
};

module.exports = function glslLoader(source) {
  return source.replace(/`([^`]*)`/g, (whole, body) => {
    if (!/#version|vec3 /.test(body)) return whole;
    let out = body
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

    for (const [long, short] of Object.entries(LOCALS)) {
      // A short name that is already taken in this shader would fuse two
      // different variables into one, which compiles and then renders nonsense.
      if (new RegExp('\\b' + short + '\\b').test(out) && new RegExp('\\b' + long + '\\b').test(out)) {
        throw new Error('glsl-loader: cannot shorten ' + long + ' to ' + short + ', which is already in use');
      }
      out = out.replace(new RegExp('\\b' + long + '\\b', 'g'), short);
    }

    // Newlines mean nothing to GLSL once the preprocessor is out of the way, so
    // fold the shader onto one line. Two rules keep that safe: a `#` directive
    // runs to the end of ITS line, so the breaks either side of one stay; and a
    // join must not fuse two tokens, so a line ending in punctuation takes the
    // next straight on while anything else -- a `return` that wrapped, say --
    // keeps a single space.
    out = out.split('\n').reduce((a, l) => a +
      (/^#/.test(l) || /^#/.test(a.split('\n').pop()) ? '\n'
        : /[-+*/%<>=!&|^?:;,(){}[\].]$/.test(a) ? '' : ' ') + l);

    return '`' + out + '`';
  });
};
