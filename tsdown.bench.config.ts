import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["bench/run.ts"],
  outDir: "bench/dist",
  clean: true,
  format: ["esm"],
  dts: false,
  sourcemap: true,
  platform: "node",
  target: "es2023",
  tsconfig: "tsconfig.bench.json",
  deps: { neverBundle: ["rolldown"] },
  fixedExtension: false,
});
