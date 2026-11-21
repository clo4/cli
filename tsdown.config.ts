import { defineConfig } from "tsdown";
import type { UserConfig } from "tsdown";

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
// The one chunk index.js has is the command `completion` loads with
// `import()`, so a run that doesn't complete or print a script never reads it.
// That command is written against the public exports alone, so the chunk
// imports them from index.js by their public names. Under the default
// `preserveEntrySignatures`, or "strict", rolldown turns index.js into a facade
// over a shared chunk, which every run would load too. "allow-extension"
// lets the chunk import from index.js, and would let rolldown add exports to
// it for anything else the chunk needed: test/dist.test.ts checks that
// index.js exports only the public names, and that the chunk imports nothing
// else.
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
} satisfies UserConfig;

// The index bundle is minified because V8 scans every byte of it on each
// import, and a CLI imports it on every run. Minifying it cut a run by 0.1 to
// 0.4 ms. Stack traces show minified names unless Node runs with
// --enable-source-maps. The testing bundle isn't minified, so spec check
// failures stay readable.
export default defineConfig([
  {
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    minify: true,
    inputOptions: { preserveEntrySignatures: "allow-extension" },
  },
  { ...shared, entry: ["src/testing.ts"], clean: false },
]);
