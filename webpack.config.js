const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const HtmlPlugin = require("html-webpack-plugin");

/** Every contribution gets its own bundle + its own HTML entry page. */
const entries = {
  hub: "./src/Hub/Hub.tsx",
  widget: "./src/Widget/Widget.tsx",
  actions: "./src/Actions/Actions.ts",
};

/**
 * Bundle filenames carry a content hash.
 *
 * Azure DevOps serves extension assets through a caching CDN, and the HTML
 * entry pages are fetched by fixed path. With a fixed bundle name a browser
 * could keep serving an old `hub.js` indefinitely - two users then run
 * different builds against different storage namespaces and never see each
 * other. A content hash makes every build a new URL, so a stale bundle is
 * simply not addressable.
 */
module.exports = (_env, argv) => ({
  target: ["web", "es2020"],
  entry: entries,
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name]/[name].[contenthash:8].js",
    publicPath: "",
    clean: true,
  },
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
    alias: { "@core": path.resolve(__dirname, "src/core") },
  },
  module: {
    rules: [
      { test: /\.tsx?$/, use: "ts-loader", exclude: /node_modules/ },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  // Nothing is externalised, so the bundle stays self-contained - required
  // for air-gapped installs.
  performance: { hints: false },
  devtool: argv.mode === "production" ? "source-map" : "eval-source-map",
  plugins: [
    new HtmlPlugin({
      template: "src/Hub/Hub.html",
      filename: "hub/Hub.html",
      chunks: ["hub"],
      inject: "body",
      publicPath: "../",
    }),
    new HtmlPlugin({
      template: "src/Widget/Widget.html",
      filename: "widget/Widget.html",
      chunks: ["widget"],
      inject: "body",
      publicPath: "../",
    }),
    new HtmlPlugin({
      template: "src/Actions/Actions.html",
      filename: "actions/Actions.html",
      chunks: ["actions"],
      inject: "body",
      publicPath: "../",
    }),
    new CopyPlugin({ patterns: [{ from: "static", to: "../static", noErrorOnMissing: true }] }),
  ],
});
