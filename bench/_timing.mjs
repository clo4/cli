import { writeFileSync } from "node:fs";

// The timed entry point. bench/run.ts runs `node _timing.mjs <args>` with
// BENCH_BUNDLE set to a bundled adapter. The clock starts before the bundle is
// imported, so reading and compiling the bundle and loading the Node built-ins
// it imports are all measured. Node's own startup and this file are not.
//
// The elapsed time is written to BENCH_OUT on the 'exit' event, which fires
// whether the CLI sets process.exitCode or calls process.exit().
const start = performance.now();

process.on("exit", () => {
  writeFileSync(process.env.BENCH_OUT, String(performance.now() - start));
});

await import(process.env.BENCH_BUNDLE);
