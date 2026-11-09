import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { build as rolldownBuild } from "rolldown";

import * as CLI from "../src/index.js";

type Adapter = readonly [library: string, scriptUrl: URL];
type BenchSignal = "SIGINT" | "SIGTERM";
type Library = readonly [library: string, script: string];
type Scenario = readonly [scenario: string, args: readonly string[], expected?: Expected];

interface Expected {
  status: number;
  stdout?: string;
}
type Status = number | string;

interface BenchOptions {
  samples: number;
  warmup: number;
  concurrency: number;
  csvOut: string | undefined;
}

interface RunResult {
  total: number;
  self: number;
  status: Status;
  stdout: string;
}

interface Job {
  library: string;
  scenario: string;
  bundle: string;
  args: readonly string[];
}

interface Bucket {
  selfTimes: number[];
  totalTimes: number[];
  statuses: Map<Status, number>;
  missing: number;
}

interface Progress {
  tick(): void;
  finish(): void;
}

interface InterruptController {
  readonly signal: BenchSignal | undefined;
  track(child: ChildProcess): void;
  clear(child: ChildProcess): void;
  throwIfInterrupted(): void;
  dispose(): void;
}

class BenchmarkInterrupted extends Error {
  constructor(readonly signal: BenchSignal | undefined) {
    super("Benchmark interrupted");
  }
}

const benchDir = fileURLToPath(new URL("..", import.meta.url));
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const timingEntry = join(benchDir, "_timing.mjs");
const baselineScenario = "process startup";

/** Differences smaller than this are reported as too small to matter. */
const negligibleMs = 0.25;

/**
 * The environment every CLI runs with: the parent's, minus variables that make
 * some libraries do extra work, such as oclif loading TypeScript support under
 * NODE_ENV=development, logging under DEBUG, or turning colors on under CI
 * (GitHub Actions sets CI=true) even though output is piped.
 */
const childEnv: NodeJS.ProcessEnv = { ...process.env };
for (const name of ["NODE_ENV", "NODE_OPTIONS", "DEBUG", "FORCE_COLOR", "CI"]) {
  delete childEnv[name];
}

const adapters: readonly Adapter[] = [
  ["baseline", new URL("../baseline.mjs", import.meta.url)],
  ["@clo4/cli", new URL("../clo4-cli.mjs", import.meta.url)],
  ["Commander", new URL("../commander.mjs", import.meta.url)],
  ["Yargs", new URL("../yargs.mjs", import.meta.url)],
  ["Cac", new URL("../cac.mjs", import.meta.url)],
  ["citty", new URL("../citty.mjs", import.meta.url)],
  ["Clipanion", new URL("../clipanion.mjs", import.meta.url)],
  ["oclif", new URL("../oclif.mjs", import.meta.url)],
  ["sade", new URL("../sade.mjs", import.meta.url)],
  ["Stricli", new URL("../stricli.mjs", import.meta.url)],
  ["Cliffy", new URL("../cliffy.mjs", import.meta.url)],
  ["Effect", new URL("../effect.mjs", import.meta.url)],
  ["gunshi", new URL("../gunshi.mjs", import.meta.url)],
  ["Optique", new URL("../optique.mjs", import.meta.url)],
  ["clerc", new URL("../clerc.mjs", import.meta.url)],
  ["cmd-ts", new URL("../cmd-ts.mjs", import.meta.url)],
  ["brocli", new URL("../brocli.mjs", import.meta.url)],
  ["node:util parseArgs", new URL("../node-parseargs.mjs", import.meta.url)],
];

/**
 * Scenarios with an expected result are checked once per library before
 * timing starts, so a broken adapter fails the run instead of being timed.
 */
const scenarios: readonly Scenario[] = [
  ["top-level --help", ["--help"], { status: 0 }],
  ["nested help (3 levels)", ["remote", "add", "--help"], { status: 0 }],
  [
    "build variadic + options",
    ["build", "a", "b", "c", "--out", "dist", "--mode", "release", "--watch", "-vv"],
    { status: 0, stdout: "build:a,b,c:dist:release:true:2\n" },
  ],
  ["alias dispatch", ["b", "a", "--out", "dist"], { status: 0, stdout: "build:a:dist:-:false:0\n" }],
  [
    "nested dispatch",
    ["remote", "add", "origin", "https://example.com", "--force", "--tag", "v1"],
    { status: 0, stdout: "add:origin:https://example.com:true:v1\n" },
  ],
  ["second group", ["config", "set", "key", "value"], { status: 0, stdout: "set:key:value\n" }],
  // --out is given so that libraries which check required options first still
  // reach their unknown-option check. Cliffy and citty accept the unknown
  // option and run the build, so this isn't checked.
  ["unknown option", ["build", "a", "--out", "dist", "--uot", "x"]],
];

/**
 * Scenarios only @clo4/cli can run. They're left out of the comparison, and
 * their CSV columns come after every other column, so adding one keeps the
 * earlier columns of the history file in place.
 */
const ownScenarios: readonly Scenario[] = [
  // What bash runs on Tab after `forge remote add origin url --`.
  ["completion", ["completion", "complete", "--gate-options", "--", "remote", "add", "origin", "url", "--"]],
];

process.exitCode = await CLI.run({
  name: "clo4-cli-bench",
  description: "Benchmark @clo4/cli against other JavaScript CLI libraries.",
  options: [
    CLI.help,
    {
      name: "--samples",
      description: "Measurements per scenario.",
      args: { name: "count" },
    },
    {
      name: "--warmup",
      description: "Discarded warmup runs per scenario.",
      args: { name: "count" },
    },
    {
      name: "--concurrency",
      description: "Concurrent processes: a positive integer or auto (default: 1).",
      args: { name: "count" },
    },
    {
      name: "--csv-out",
      description: "Write a header and a single data row of medians to this file.",
      args: { name: "file" },
    },
  ],
  action(init) {
    return runBenchmark(readOptions(init));
  },
});

function readOptions({ options }: CLI.ActionInit): BenchOptions {
  return {
    samples: readPositiveIntOption(options.get("--samples"), "--samples", 50),
    warmup: readPositiveIntOption(options.get("--warmup"), "--warmup", 3),
    concurrency: readConcurrency(options.get("--concurrency")),
    csvOut: options.get("--csv-out"),
  };
}

async function runBenchmark({ samples, warmup, concurrency, csvOut }: BenchOptions): Promise<number> {
  if (!existsSync(new URL("../../dist/index.js", import.meta.url))) {
    console.error("Build @clo4/cli before benchmarking: pnpm build");
    return 1;
  }

  const bundleDir = mkdtempSync(join(tmpdir(), "clo4-cli-bench-compiled-"));

  try {
    const libraries = await bundleAdapters(bundleDir);
    const baseline = libraries.find(([library]) => library === "baseline");
    const measuredLibraries = libraries.filter(([library]) => library !== "baseline");
    const ours = libraries.find(([library]) => library === "@clo4/cli");
    if (baseline === undefined || ours === undefined) {
      throw new Error("missing baseline or @clo4/cli benchmark adapter");
    }

    const jobs: Job[] = [{ library: "baseline", scenario: baselineScenario, bundle: baseline[1], args: [] }];
    for (const [library, bundle] of measuredLibraries) {
      for (const [scenario, args] of scenarios) {
        jobs.push({ library, scenario, bundle, args });
      }
    }
    for (const [scenario, args] of ownScenarios) {
      jobs.push({ library: "@clo4/cli", scenario, bundle: ours[1], args });
    }

    const interrupt = createInterruptController();
    const results = new Map<string, Bucket>();

    try {
      const failures = await checkOutputs(measuredLibraries, interrupt, concurrency, bundleDir);
      if (failures.length > 0) {
        console.error("These adapters printed the wrong output, so the benchmark didn't run:");
        for (const failure of failures) {
          console.error(`  ${failure}`);
        }
        return 1;
      }

      console.log(`CLI startup benchmark (${samples} samples, ${warmup} warmup rounds)`);
      console.log(`cwd: ${packageRoot}`);
      console.log(`cpu: ${cpus()[0]?.model ?? "unknown"}, node ${process.version}`);
      console.log(`concurrency: ${concurrency} (${availableParallelism()} available logical CPUs)`);
      if (concurrency > 1) {
        console.log("Concurrent processes share CPU resources; compare with runs at the same concurrency.");
      }
      console.log(
        "Each adapter is bundled with its library and minified before timing, and bundling isn't timed.",
      );
      console.log("Every round runs each library and scenario once, in a new random order.");
      console.log(
        "`self` runs from just before the bundle is imported to the process's exit event. It includes",
      );
      console.log("loading the bundle and its Node built-ins, and leaves out Node's own startup.");
      console.log("`total` is the whole process, timed from outside, so it includes Node's startup.");
      console.log("");

      const progress = createProgress((warmup + samples) * jobs.length);
      for (let i = 0; i < warmup + samples; i += 1) {
        await forEachConcurrent(shuffled(jobs), concurrency, async (job, slot) => {
          const result = await runOnce(
            job.bundle,
            job.args,
            interrupt,
            join(bundleDir, `timing-${slot}.txt`),
          );
          progress.tick();
          if (i >= warmup) {
            recordResult(bucketFor(results, job.library, job.scenario), result);
          }
        });
      }
      progress.finish();
    } catch (error) {
      if (error instanceof BenchmarkInterrupted) {
        console.error("\nBenchmark interrupted.");
        return exitCodeForSignal(error.signal);
      }
      throw error;
    } finally {
      interrupt.dispose();
    }

    console.log(
      formatRow(["library", "scenario", "self p50", "self p10", "self p90", "total p50", "n", "exit codes"]),
    );
    console.log(
      formatRow(["-------", "--------", "--------", "--------", "--------", "---------", "-", "----------"]),
    );
    printRow(results.get(keyFor("baseline", baselineScenario)), "baseline", baselineScenario);
    for (const [library] of measuredLibraries) {
      for (const [scenario] of scenarios) {
        printRow(results.get(keyFor(library, scenario)), library, scenario);
      }
    }
    for (const [scenario] of ownScenarios) {
      printRow(results.get(keyFor("@clo4/cli", scenario)), "@clo4/cli", scenario);
    }
    printComparison(results, measuredLibraries);

    if (csvOut !== undefined) {
      writeFileSync(csvOut, buildCsv(results, measuredLibraries, samples, concurrency));
      console.log(`\nWrote CSV row to ${csvOut}`);
    }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }

  return 0;
}

/**
 * Build a two-line CSV (header and one data row) of this run's medians. The
 * columns follow the static scenario and adapter lists, so rows from different
 * runs line up in a history file. The history file only accepts new columns at
 * the end. When adding a library or scenario, preserve the existing column
 * order and append its columns after the concurrency metadata.
 */
function buildCsv(
  results: Map<string, Bucket>,
  measuredLibraries: readonly Library[],
  samples: number,
  concurrency: number,
): string {
  const header = ["timestamp_utc", "commit", "node_version", "cpu", "samples"];
  const row = [
    new Date().toISOString(),
    process.env.GITHUB_SHA ?? "local",
    process.version,
    (cpus()[0]?.model ?? "unknown").replaceAll(",", " "),
    String(samples),
  ];

  const cell = (value: number): string => (Number.isFinite(value) ? value.toFixed(4) : "");
  const median = (library: string, scenario: string): number =>
    percentile(results.get(keyFor(library, scenario))?.selfTimes ?? [], 0.5);

  header.push("baseline_self_med");
  row.push(cell(median("baseline", baselineScenario)));

  for (const [scenario] of [...scenarios, ...ownScenarios]) {
    header.push(`${slug(scenario)}_clo4-cli_self_med`);
    row.push(cell(median("@clo4/cli", scenario)));
  }

  // Geomeans include the baseline's time; subtract baseline_self_med to leave
  // it out.
  for (const [library] of measuredLibraries) {
    header.push(`geomean_${slug(library)}`);
    row.push(cell(geometricMean(scenarios.map(([scenario]) => median(library, scenario)))));
  }

  // Append metadata so the existing CI history remains compatible.
  header.push("concurrency");
  row.push(String(concurrency));

  return `${header.join(",")}\n${row.join(",")}\n`;
}

async function bundleAdapters(outDir: string): Promise<Library[]> {
  return Promise.all(
    adapters.map(async ([library, scriptUrl]) => {
      const output = join(outDir, `${slug(library)}.mjs`);
      await rolldownBuild({
        input: fileURLToPath(scriptUrl),
        platform: "node",
        logLevel: "silent",
        transform: { target: "es2022" },
        output: {
          file: output,
          format: "esm",
          codeSplitting: false,
          sourcemap: false,
          // Every adapter is minified, as a CLI shipped to users would be.
          minify: true,
        },
      });
      return [library, output] as const;
    }),
  );
}

/**
 * Run each scenario that has an expected result once per library, and return
 * a description of every mismatch.
 */
async function checkOutputs(
  measuredLibraries: readonly Library[],
  interrupt: InterruptController,
  concurrency: number,
  timingDir: string,
): Promise<string[]> {
  const failures: string[] = [];
  const checks = measuredLibraries.flatMap(([library, bundle]) =>
    scenarios.flatMap(([scenario, args, expected]) =>
      expected === undefined ? [] : [{ library, bundle, scenario, args, expected }],
    ),
  );
  await forEachConcurrent(
    checks,
    concurrency,
    async ({ library, bundle, scenario, args, expected }, slot) => {
      const result = await runOnce(bundle, args, interrupt, join(timingDir, `timing-${slot}.txt`));
      if (result.status !== expected.status) {
        failures.push(`${library}, ${scenario}: exited ${result.status}, expected ${expected.status}`);
      } else if (expected.stdout !== undefined && result.stdout !== expected.stdout) {
        failures.push(
          `${library}, ${scenario}: printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(expected.stdout)}`,
        );
      }
    },
  );
  return failures;
}

/** Drain active processes before propagating an error and cleaning up their files. */
async function forEachConcurrent<T>(
  items: readonly T[],
  concurrency: number,
  action: (item: T, slot: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let stopped = false;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async (_, slot) => {
    try {
      while (!stopped && next < items.length) {
        const item = items[next++];
        await action(item, slot);
      }
    } catch (error) {
      stopped = true;
      throw error;
    }
  });
  const settled = await Promise.allSettled(workers);
  for (const result of settled) {
    if (result.status === "rejected") {
      throw result.reason;
    }
  }
}

/**
 * Run one CLI through the timed entry point. Output goes to pipes that are
 * read to the end, as it would be for a CLI piped into another program, so
 * libraries that write through process.stdout pay for setting up the stream.
 */
async function runOnce(
  bundle: string,
  args: readonly string[],
  interrupt: InterruptController,
  timingFile: string,
): Promise<RunResult> {
  interrupt.throwIfInterrupted();
  rmSync(timingFile, { force: true });
  const start = performance.now();
  const child = spawn(process.execPath, [timingEntry, ...args], {
    cwd: benchDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...childEnv, BENCH_BUNDLE: pathToFileURL(bundle).href, BENCH_OUT: timingFile },
  });
  interrupt.track(child);

  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.resume();

  return new Promise((resolve, reject) => {
    let settled = false;

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      interrupt.clear(child);
      if (interrupt.signal !== undefined) {
        reject(new BenchmarkInterrupted(interrupt.signal));
        return;
      }
      resolve({
        total: performance.now() - start,
        self: Number.NaN,
        status: basename(error.name),
        stdout,
      });
    });

    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      interrupt.clear(child);
      if (interrupt.signal !== undefined) {
        reject(new BenchmarkInterrupted(interrupt.signal));
        return;
      }

      let self = Number.NaN;
      try {
        self = Number.parseFloat(readFileSync(timingFile, "utf8"));
      } catch {
        // Child exited before writing a timing sample.
      }
      resolve({
        total: performance.now() - start,
        self,
        status: code ?? signal ?? "signal",
        stdout,
      });
    });
  });
}

function bucketFor(results: Map<string, Bucket>, library: string, scenario: string): Bucket {
  const key = keyFor(library, scenario);
  const existing = results.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const bucket: Bucket = {
    selfTimes: [],
    totalTimes: [],
    statuses: new Map(),
    missing: 0,
  };
  results.set(key, bucket);
  return bucket;
}

function recordResult(bucket: Bucket, result: RunResult): void {
  bucket.totalTimes.push(result.total);
  if (Number.isFinite(result.self)) {
    bucket.selfTimes.push(result.self);
  } else {
    bucket.missing += 1;
  }
  bucket.statuses.set(result.status, (bucket.statuses.get(result.status) ?? 0) + 1);
}

function printRow(bucket: Bucket | undefined, library: string, scenario: string): void {
  const self = bucket?.selfTimes ?? [];
  const total = bucket?.totalTimes ?? [];
  const statusCells = [...(bucket?.statuses ?? new Map<Status, number>()).entries()]
    .map(([status, count]) => `${status}:${count}`)
    .join(",");
  console.log(
    formatRow([
      library,
      scenario,
      fmt(percentile(self, 0.5)),
      fmt(percentile(self, 0.1)),
      fmt(percentile(self, 0.9)),
      fmt(percentile(total, 0.5)),
      String(total.length),
      bucket !== undefined && bucket.missing > 0
        ? `${statusCells} (!${bucket.missing} no-timing)`
        : statusCells,
    ]),
  );
}

/**
 * Compare each library with @clo4/cli by the geometric mean of its scenario
 * medians. The interval comes from resampling each scenario's measurements
 * (a bootstrap): when it includes zero, the run can't tell the two apart.
 * Ratios leave out the baseline's time, the cost of importing any file, which
 * every library pays and which would otherwise pull every ratio towards 1.
 */
function printComparison(results: Map<string, Bucket>, measuredLibraries: readonly Library[]): void {
  const random = mulberry32(0x5eed);
  const resamples = 1000;
  const samplesFor = (library: string): number[][] =>
    scenarios.map(([scenario]) => results.get(keyFor(library, scenario))?.selfTimes ?? []);
  const geomeanOfMedians = (cells: readonly (readonly number[])[]): number =>
    geometricMean(cells.map((cell) => percentile(cell, 0.5)));
  const resampledGeomeans = (cells: readonly (readonly number[])[]): number[] =>
    Array.from({ length: resamples }, () =>
      geomeanOfMedians(cells.map((cell) => cell.map(() => cell[Math.floor(random() * cell.length)]))),
    );

  const baseline = percentile(results.get(keyFor("baseline", baselineScenario))?.selfTimes ?? [], 0.5);
  const ourCells = samplesFor("@clo4/cli");
  const ourMean = geomeanOfMedians(ourCells);
  const ourResampled = resampledGeomeans(ourCells);

  console.log("");
  console.log("Comparison with @clo4/cli (geometric mean of scenario medians; lower is better)");
  console.log(`@clo4/cli: ${fmt(ourMean)}`);
  console.log(formatComparisonRow(["library", "geomean", "difference (95% interval)", "result"]));
  console.log(formatComparisonRow(["-------", "-------", "-------------------------", "------"]));

  for (const [library] of measuredLibraries) {
    if (library === "@clo4/cli") {
      continue;
    }
    const cells = samplesFor(library);
    const mean = geomeanOfMedians(cells);
    const differences = resampledGeomeans(cells).map((value, index) => value - ourResampled[index]);
    const low = percentile(differences, 0.025);
    const high = percentile(differences, 0.975);
    console.log(
      formatComparisonRow([
        library,
        fmt(mean),
        `${signed(mean - ourMean)} (${signed(low)} to ${signed(high)})`,
        comparisonText(ourMean - baseline, mean - baseline, low, high),
      ]),
    );
  }
}

function comparisonText(ours: number, other: number, low: number, high: number): string {
  if (![ours, other, low, high].every(Number.isFinite) || ours <= 0 || other <= 0) {
    return "n/a";
  }
  if (low <= 0 && high >= 0) {
    return "no clear difference";
  }
  if (Math.abs(other - ours) < negligibleMs) {
    return `less than ${negligibleMs}ms apart`;
  }
  const ratio = other / ours;
  if (ratio >= 2) {
    return `@clo4/cli faster (${ratio.toFixed(1)}x)`;
  }
  if (ratio <= 0.5) {
    return `@clo4/cli slower (${(1 / ratio).toFixed(1)}x)`;
  }
  return other > ours ? "@clo4/cli faster" : "@clo4/cli slower";
}

function signed(value: number): string {
  return Number.isFinite(value) ? `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}ms` : "n/a";
}

function geometricMean(values: readonly number[]): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function fmt(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
}

/** Percentile with linear interpolation; `fraction` 0.5 is the median. */
function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** A small seeded random number generator, so the intervals are repeatable. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function readPositiveIntOption(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe positive integer`);
  }
  return value;
}

function readConcurrency(raw: string | undefined): number {
  const available = availableParallelism();
  if (raw === "auto") {
    return available;
  }
  return Math.min(available, readPositiveIntOption(raw, "--concurrency", 1));
}

function formatRow(cells: readonly string[]): string {
  const widths = [19, 24, 10, 10, 10, 10, 4, 24];
  return cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
}

function formatComparisonRow(cells: readonly string[]): string {
  const widths = [19, 10, 32, 28];
  return cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
}

function createInterruptController(): InterruptController {
  let signal: BenchSignal | undefined;
  const children = new Set<ChildProcess>();

  const onSignal = (nextSignal: BenchSignal) => {
    signal ??= nextSignal;
    for (const child of children) {
      child.kill(nextSignal);
    }
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return {
    get signal() {
      return signal;
    },
    track(child) {
      children.add(child);
      if (signal !== undefined) {
        child.kill(signal);
      }
    },
    clear(child) {
      children.delete(child);
    },
    throwIfInterrupted() {
      if (signal !== undefined) {
        throw new BenchmarkInterrupted(signal);
      }
    },
    dispose() {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    },
  };
}

function exitCodeForSignal(signal: BenchSignal | undefined): number {
  if (signal === "SIGTERM") {
    return 143;
  }
  return 130;
}

function createProgress(total: number): Progress {
  let current = 0;
  const isTty = Boolean(process.stderr.isTTY);
  const width = 24;
  const reportEvery = 10;

  render();

  return {
    tick() {
      if (!isTty) {
        return;
      }
      current += 1;
      if (current % reportEvery === 0 || current === total) {
        render();
      }
    },
    finish() {
      if (isTty) {
        process.stderr.write("\n");
      }
    },
  };

  function render() {
    const percent = total === 0 ? 100 : Math.floor((current / total) * 100);
    const bar = progressBar(current, total, width);
    const remaining = Math.max(0, total - current);
    const text = `benchmark [${bar}] ${String(percent).padStart(3)}% ${current}/${total}, ${remaining} remaining`;
    if (isTty) {
      process.stderr.write(`\r${text}`);
      return;
    }

    process.stderr.write(`${text}\n`);
  }
}

function progressBar(current: number, total: number, width: number): string {
  if (total <= 0) {
    return "█".repeat(width);
  }

  const parts = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];
  const scaled = Math.min(
    width * parts.length,
    Math.max(0, Math.round((current / total) * width * parts.length)),
  );
  const full = Math.floor(scaled / parts.length);
  const partial = scaled % parts.length;
  const empty = width - full - (partial > 0 ? 1 : 0);
  return `${"█".repeat(full)}${parts[partial]}${" ".repeat(empty)}`;
}

function keyFor(library: string, scenario: string): string {
  return `${library}\0${scenario}`;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
}
