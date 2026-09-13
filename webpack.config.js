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
      // Declared AFTER the GLSL rule on purpose: webpack collects loaders in
      // rule order and runs them last-first, so this one runs before shaders
      // are folded into string literals and never sees shader text.
      {
        test: /\.js$/,
        include: path.resolve(__dirname, "src"),
        use: path.resolve(__dirname, "build/gl-consts.cjs"),
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
        // The service worker is copied, not bundled, and not in the jam zip -- but
        // the property mangler still renamed the ServiceWorker API out from under
        // it (`waitUntil`, `respondWith`), which Terser's DOM list does not carry.
        exclude: /service-worker/,
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
            // `toplevel` renames variables but never properties, so this mangles
            // our own property names too.
            //
            // THE RULE THAT MAKES IT SAFE: only names of three or more characters
            // are touched, so every format that outlives a build is protected by
            // being one or two characters long --
            //   save keys   (v t g c h n b z r f s, index.js persist())
            //   wire keys   (t i n p b e r s, net.js): renaming these would make
            //               this build unable to play with any other.
            //   ladder keys (mz rs sh): LADDERS carries them as strings and spends
            //               them as `state[key]`, so the dotted reads must keep
            //               matching the string.
            properties: {
              regex: /^.{3,}$/,
              // Quoted stays quoted: render.js reads `prog.u['pal[0]'] || prog.u.pal`,
              // and mangling only the dotted half is exactly how that breaks.
              keep_quoted: true,
              reserved: [
                // Uniform names: gl.js fills `p.u[name]` from getActiveUniform, so
                // these keys arrive from the shader at runtime and Terser cannot see
                // them, but every read is dotted. Kept in step with
                // build/check-shaders.mjs.
                'eye', 'sky', 'fog', 'idPass', 'sentinel', 'pal', 'poses',
              ],
            },
          },
        },
      }),
      new HtmlMinimizerPlugin(),
    ],
  },
};
