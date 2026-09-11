const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");
const HtmlMinimizerPlugin = require('html-minimizer-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: "./src/index.js",
  output: {
    filename: "main.js",
    path: path.resolve(__dirname, "docs"),
  },
  watch: process.argv.indexOf("--watch") > -1,
  module: {
    rules: [
      {
        test: /render\.js$/,
        use: path.resolve(__dirname, "build/glsl-loader.cjs"),
      },
    ],
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'service-worker.js', to: 'service-worker.js' },
      ],
    }),
  ], 
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: false,
        terserOptions: {
          ecma: 2020,
          output: { comments: false },
          compress: {
            drop_console: true,
            passes: 4,
            unsafe: true,
            unsafe_arrows: true,
            unsafe_math: true,
            unsafe_methods: true,
            booleans_as_integers: true,
            pure_getters: true,
          },
          mangle: {
            toplevel: true,
            // Terser's `toplevel` renames variables but never object properties,
            // which is why `driftChance`, `trackMesh` and `horns` were shipping in
            // full. This mangles our own property names too.
            //
            // The rule that makes it safe: only names of THREE OR MORE characters
            // are touched. Everything already at one or two characters is left
            // exactly as it is -- which costs nothing, since a one-character name
            // has nothing left to save -- and that single line protects both
            // formats that outlive a build:
            //   the save keys  (v t g c h n b z r f s, index.js persist())
            //   the wire keys  (t i n p b e r s, net.js) -- renaming these would
            //                  make this build unable to play with any other, and
            //                  would silently void every existing save.
            properties: {
              regex: /^.{3,}$/,
              // Quoted stays quoted: render.js reads `prog.u['pal[0]'] || prog.u.pal`,
              // and mangling only the dotted half is exactly how that breaks.
              keep_quoted: true,
              reserved: [
                // Uniform names. gl.js fills `p.u[name]` from getActiveUniform, so
                // the keys arrive from the shader at runtime and Terser cannot see
                // them -- but every read is dotted, and would be renamed to a name
                // the GLSL never declares. Kept in step with build/check-shaders.mjs.
                'eye', 'sky', 'fog', 'idPass', 'sentinel', 'pal', 'poses',
                // The ladder keys. LADDERS carries these as strings and index.js
                // spends them as `state[key]`, so the dotted reads elsewhere have to
                // keep matching the string.
                'maxZoom', 'res', 'shutterTier',
              ],
            },
          },
        },
      }),
      new HtmlMinimizerPlugin(),
    ],
  },
};
