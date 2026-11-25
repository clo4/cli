import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

// The package publicly exports three entries (see package.json "exports"):
// "." (index), "./testing" and "./analyze". They are built as SEPARATE
// single-entry bundles on purpose:
//
//   * Listing the internal modules (parse, help, completion and the rest) as
//     entries — or even just bundling index + testing together — makes rolldown
//     emit shared chunks that index.js imports at runtime. That transitive
//     module-loading dominated cold-start cost.
//   * One entry per build means each output is fully self-contained (no shared
//     chunk to load), which roughly halves index's import→finish time.
//
// The completion command is part of index.js. Loading it with `import()` from
// a chunk of its own saved a run that doesn't complete about 70 µs, but cost
// every Tab about 330 µs to load the second file. A CLI bundled with that
// chunk was slower on every run, because its bundler moved the library into a
// shared chunk that both the entry and the completion chunk import.
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
  // package.json "exports" paths, like ./dist/index.js, resolve.
  fixedExtension: false,
} satisfies UserConfig;

// The index bundle is minified because V8 scans every byte of it on each
// import, and a CLI imports it on every run. Minifying it cut a run by 0.1 to
// 0.4 ms. Stack traces show minified names unless Node runs with
// --enable-source-maps. The other bundles aren't minified, so spec check
// failures stay readable, and nothing imports them on every run.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    minify: true,
  },
  { ...shared, entry: ["src/testing.ts"], clean: false },
  { ...shared, entry: ["src/analyze.ts"], clean: false },
]);
