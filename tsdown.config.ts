import { defineConfig } from "tsdown";

// The package publicly exports exactly two entries (see package.json "exports"):
// "." (index) and "./testing". They are built as SEPARATE single-entry bundles
// on purpose:
//
//   * Listing the internal modules (analyze, errors, help, parse, run, util) as
//     entries — or even just bundling index + testing together — makes rolldown
//     emit shared chunks that index.js imports at runtime. That transitive
//     module-loading dominated cold-start cost.
//   * One entry per build means each output is fully self-contained (no shared
//     chunk to load), which roughly halves index's import→finish time.
//
// `platform: "node"` (not "neutral") so the lone runtime dependency,
// fastest-levenshtein, is inlined into the bundle — under "neutral" tsdown
// force-externalizes every bare import, leaving an extra module to load on the
// hot path. The CLI source imports no node builtins (the single `process` touch
// is guarded via `globalThis`), so node-target output is identical apart from
// the inlined dependency, and the package is only ever consumed from Node.
const shared = {
  format: ["esm"],
  dts: true,
  sourcemap: true,
  platform: "node",
  target: "es2022",
  deps: { alwaysBundle: ["fastest-levenshtein"] },
  // platform "node" defaults fixedExtension to true (.mjs); keep .js so the
  // package.json "exports" paths (./dist/index.js, ./dist/testing.js) resolve.
  fixedExtension: false,
} as const;

export default defineConfig([
  { ...shared, entry: ["src/index.ts"], clean: true },
  { ...shared, entry: ["src/testing.ts"], clean: false },
]);
