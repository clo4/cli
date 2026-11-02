import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

/**
 * Start the "import → finish" timer for a benchmark adapter.
 *
 * Call this first, then dynamically `import()` the CLI library so its
 * load/compile cost is included in the measured region. The elapsed time is
 * written to the file named by the `BENCH_OUT` env var when the process exits.
 *
 * An `exit` handler is used (rather than printing) so timing is captured
 * reliably even when a library calls `process.exit()` on `--help` or errors
 * (yargs and cac both do). `writeFileSync` is synchronous, so it completes
 * before the process tears down — no stdout-flush races.
 */
export function startTiming() {
  const t0 = performance.now();
  process.on("exit", () => {
    if (!process.env.BENCH_OUT) {
      return;
    }
    try {
      writeFileSync(process.env.BENCH_OUT, String(performance.now() - t0));
    } catch {
      // Running an adapter directly (no BENCH_OUT target) is fine; ignore.
    }
  });
}
