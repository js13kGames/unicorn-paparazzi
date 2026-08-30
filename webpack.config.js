const path = require("path");
const ZipPlugin = require("zip-webpack-plugin");
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
  plugins: [
    new ZipPlugin({
      include: [/\.js$/, /\.html$/],
    }),
    new HtmlWebpackPlugin({
      template: "./index.html",
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: 'manifest.json' },
        { from: 'service-worker.js', to: 'service-worker.js' },
        { from: 'icon-192.png', to: 'icon-192.png' },
        { from: 'icon-512.png', to: 'icon-512.png' },
      ],
    }),
  ], 
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        extractComments: true,
        terserOptions: {
          output: {
            comments: false,
          },
          compress: {
            drop_console: true
          }
        },
      }),
      new HtmlMinimizerPlugin(),
    ],
  },
};
