import { defineConfig } from "tsdown";

// The package publicly exports exactly two entries (see package.json "exports"):
// "." (index) and "./testing". They are built as SEPARATE single-entry bundles
// on purpose:
//
//   * Listing the internal modules (parse, help, completion and the rest) as
//     entries — or even just bundling index + testing together — makes rolldown
//     emit shared chunks that index.js imports at runtime. That transitive
//     module-loading dominated cold-start cost.
//   * One entry per build means each output is fully self-contained (no shared
//     chunk to load), which roughly halves index's import→finish time.
//
// The package has no runtime dependencies, and the source has no static
// imports of node builtins (the `process` and `node:fs` uses are guarded), so each
// bundle is the library's own code only. The package is only ever consumed
// from Node, so it targets "node".
const shared = {
  format: ["esm"],
  dts: true,
  sourcemap: true,
  platform: "node",
  target: "es2022",
  // platform "node" defaults fixedExtension to true (.mjs); keep .js so the
  // package.json "exports" paths (./dist/index.js, ./dist/testing.js) resolve.
  fixedExtension: false,
} as const;

// The index bundle is minified because V8 scans every byte of it on each
// import, and a CLI imports it on every run. Minifying it cut a run by 0.1 to
// 0.4 ms. Stack traces show minified names unless Node runs with
// --enable-source-maps. The testing bundle isn't minified, so spec check
// failures stay readable.
export default defineConfig([
  { ...shared, entry: ["src/index.ts"], clean: true, minify: true },
  { ...shared, entry: ["src/testing.ts"], clean: false },
]);
