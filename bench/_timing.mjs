import { writeFileSync } from "node:fs";

// The timed entry point. bench/run.ts runs `node _timing.mjs <args>` with
// BENCH_BUNDLE set to a bundled adapter. The clock starts before the bundle is
// imported, so reading and compiling the bundle and loading the Node built-ins
// it imports are all measured. Node's own startup and this file are not.
//
// Node builds process.stdout and process.stderr the first time something reads
// them, which takes about 0.8 ms, more than most libraries' own work. Each
// getter is wrapped to time that build, so the report can show how much of a
// run went to it. The time is still part of the run.
//
// On the 'exit' event, which fires whether the CLI sets process.exitCode or
// calls process.exit(), the run's time and the build time are written to
// BENCH_OUT as JSON.
let stdio = 0;
for (const name of ["stdout", "stderr"]) {
  const { get, set, enumerable } = Object.getOwnPropertyDescriptor(process, name);
  let built = false;
  Object.defineProperty(process, name, {
    configurable: true,
    enumerable,
    set,
    get() {
      if (built) {
        return get.call(process);
      }
      const before = performance.now();
      const stream = get.call(process);
      stdio += performance.now() - before;
      built = true;
      return stream;
    },
  });
}

const start = performance.now();

process.on("exit", () => {
  writeFileSync(process.env.BENCH_OUT, JSON.stringify({ self: performance.now() - start, stdio }));
});

await import(process.env.BENCH_BUNDLE);
