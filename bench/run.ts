import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { build as rolldownBuild } from "rolldown";

import * as CLI from "../src/index.js";

type Adapter = readonly [library: string, scriptUrl: URL];
type BenchSignal = "SIGINT" | "SIGTERM";
type Library = readonly [library: string, script: string];
type Scenario = readonly [scenario: string, args: readonly string[]];
type Status = number | string;

interface BenchOptions {
  samples: number;
  warmup: number;
  csvOut: string | undefined;
}

interface RunResult {
  total: number;
  self: number;
  status: Status;
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
const timingFile = join(tmpdir(), `clo4-cli-bench-${process.pid}.txt`);

const adapters: readonly Adapter[] = [
  ["baseline", new URL("../baseline.mjs", import.meta.url)],
  ["@clo4/cli", new URL("../clo4-cli.mjs", import.meta.url)],
  ["Commander", new URL("../commander.mjs", import.meta.url)],
  ["Yargs", new URL("../yargs.mjs", import.meta.url)],
  ["Cac", new URL("../cac.mjs", import.meta.url)],
];

const scenarios: readonly Scenario[] = [
  ["top-level --help", ["--help"]],
  ["nested help (3 levels)", ["remote", "add", "--help"]],
  [
    "build variadic + options",
    ["build", "a", "b", "c", "--out", "dist", "--mode", "release", "--watch", "-vv"],
  ],
  ["alias dispatch", ["b", "a", "--out", "dist"]],
  ["nested dispatch", ["remote", "add", "origin", "https://example.com", "--force", "--tag", "v1"]],
  ["second group", ["config", "set", "key", "value"]],
  ["unknown option", ["build", "a", "--uot", "dist"]],
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
      name: "--csv-out",
      description: "Write a header + single data row of medians to this file.",
      args: { name: "file" },
    },
  ],
  action(init) {
    return runBenchmark(readOptions(init));
  },
});

function readOptions({ options }: CLI.ActionInit): BenchOptions {
  return {
    samples: readPositiveIntOption(options.get("--samples"), "--samples", 25),
    warmup: readPositiveIntOption(options.get("--warmup"), "--warmup", 3),
    csvOut: options.get("--csv-out"),
  };
}

async function runBenchmark({ samples, warmup, csvOut }: BenchOptions): Promise<number> {
  if (!existsSync(new URL("../../dist/index.js", import.meta.url))) {
    console.error("Build @clo4/cli before benchmarking: pnpm build");
    return 1;
  }

  const bundleDir = mkdtempSync(join(tmpdir(), "clo4-cli-bench-compiled-"));

  try {
    const libraries = await bundleAdapters(bundleDir);
    const baseline = libraries.find(([library]) => library === "baseline");
    const measuredLibraries = libraries.filter(([library]) => library !== "baseline");
    if (baseline === undefined) {
      throw new Error("missing baseline benchmark adapter");
    }
    const results = new Map<string, Bucket>();
    const baselineScenario = "process startup";
    const totalRuns =
      (warmup + samples) * (1 + scenarios.length * measuredLibraries.length + ownScenarios.length);

    console.log(`In-process CLI benchmark (${samples} samples, ${warmup} warmups, interleaved)`);
    console.log(`cwd: ${packageRoot}`);
    console.log("Adapters are prebundled before timing; bundle time is excluded from all rows.");
    console.log(
      "Runs are interleaved by round across scenarios and libraries to reduce shared-runner drift.",
    );
    console.log(
      "`self` = import->finish inside the child; `total` = full process wall-clock (about self + Node startup).",
    );
    console.log("");

    const progress = createProgress(totalRuns);
    const interrupt = createInterruptController();

    try {
      for (let i = 0; i < warmup; i += 1) {
        await runRound(baseline, measuredLibraries, false, results, baselineScenario, progress, interrupt);
      }

      for (let i = 0; i < samples; i += 1) {
        await runRound(baseline, measuredLibraries, true, results, baselineScenario, progress, interrupt);
      }
    } catch (error) {
      if (error instanceof BenchmarkInterrupted) {
        progress.finish();
        console.error("Benchmark interrupted.");
        return exitCodeForSignal(error.signal);
      }
      throw error;
    } finally {
      interrupt.dispose();
    }

    progress.finish();

    console.log(
      formatRow(["library", "scenario", "self med", "self min", "self max", "total med", "n", "statuses"]),
    );
    console.log(
      formatRow(["-------", "--------", "--------", "--------", "--------", "---------", "-", "--------"]),
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
      writeFileSync(csvOut, buildCsv(results, measuredLibraries, samples));
      console.log(`\nWrote CSV row to ${csvOut}`);
    }
  } finally {
    rmSync(timingFile, { force: true });
    rmSync(bundleDir, { recursive: true, force: true });
  }

  return 0;
}

/**
 * Build a two-line CSV (header + one data row) capturing this run's medians.
 * The column set is fixed by the static scenario and adapter lists, so rows
 * from different runs line up when appended to a history file.
 */
function buildCsv(
  results: Map<string, Bucket>,
  measuredLibraries: readonly Library[],
  samples: number,
): string {
  const header = ["timestamp_utc", "commit", "node_version", "samples"];
  const row = [new Date().toISOString(), process.env.GITHUB_SHA ?? "local", process.version, String(samples)];

  const cell = (value: number): string => (Number.isFinite(value) ? value.toFixed(4) : "");

  // Per-scenario @clo4/cli self medians. The columns keep the library's old
  // name, lode, so new rows line up with the history file.
  for (const [scenario] of scenarios) {
    header.push(`${slug(scenario)}_lode_self_med`);
    row.push(cell(stats(results.get(keyFor("@clo4/cli", scenario))?.selfTimes ?? []).median));
  }

  // Per-library geomean of scenario self medians.
  for (const [library] of measuredLibraries) {
    header.push(`geomean_${slug(library)}`);
    const medians: number[] = [];
    for (const [scenario] of scenarios) {
      const median = stats(results.get(keyFor(library, scenario))?.selfTimes ?? []).median;
      if (Number.isFinite(median) && median > 0) {
        medians.push(median);
      }
    }
    row.push(cell(geometricMean(medians)));
  }

  for (const [scenario] of ownScenarios) {
    header.push(`${slug(scenario)}_lode_self_med`);
    row.push(cell(stats(results.get(keyFor("@clo4/cli", scenario))?.selfTimes ?? []).median));
  }

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
        },
      });
      return [library, output] as const;
    }),
  );
}

async function runRound(
  baseline: Library,
  measuredLibraries: readonly Library[],
  shouldRecord: boolean,
  results: Map<string, Bucket>,
  baselineScenario: string,
  progress: Progress,
  interrupt: InterruptController,
): Promise<void> {
  const [, baselineScript] = baseline;
  const baselineResult = await runOnce(baselineScript, [], interrupt);
  progress.tick();
  if (shouldRecord) {
    recordResult(bucketFor(results, "baseline", baselineScenario), baselineResult);
  }

  for (const [scenario, args] of scenarios) {
    for (const [library, script] of measuredLibraries) {
      const result = await runOnce(script, args, interrupt);
      progress.tick();
      if (shouldRecord) {
        recordResult(bucketFor(results, library, scenario), result);
      }
    }
  }

  const ours = measuredLibraries.find(([library]) => library === "@clo4/cli");
  for (const [scenario, args] of ours ? ownScenarios : []) {
    const result = await runOnce(ours![1], args, interrupt);
    progress.tick();
    if (shouldRecord) {
      recordResult(bucketFor(results, "@clo4/cli", scenario), result);
    }
  }
}

async function runOnce(
  script: string,
  args: readonly string[],
  interrupt: InterruptController,
): Promise<RunResult> {
  interrupt.throwIfInterrupted();
  rmSync(timingFile, { force: true });
  const start = performance.now();
  const child = spawn(process.execPath, [script, ...args], {
    cwd: benchDir,
    stdio: "ignore",
    env: { ...process.env, BENCH_OUT: timingFile },
  });
  interrupt.track(child);

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
  const self = stats(bucket?.selfTimes ?? []);
  const total = stats(bucket?.totalTimes ?? []);
  const statusCells = [...(bucket?.statuses ?? new Map<Status, number>()).entries()]
    .map(([status, count]) => `${status}:${count}`)
    .join(",");
  console.log(
    formatRow([
      library,
      scenario,
      fmt(self.median),
      fmt(self.min),
      fmt(self.max),
      fmt(total.median),
      String(bucket?.totalTimes.length ?? 0),
      bucket !== undefined && bucket.missing > 0
        ? `${statusCells} (!${bucket.missing} no-timing)`
        : statusCells,
    ]),
  );
}

function printComparison(results: Map<string, Bucket>, measuredLibraries: readonly Library[]): void {
  const ours = measuredLibraries.find(([library]) => library === "@clo4/cli");
  if (ours === undefined) {
    return;
  }

  console.log("");
  console.log("Comparison (geomean of scenario self medians; lower is better)");
  console.log(formatComparisonRow(["library", "@clo4/cli", "other", "result"]));
  console.log(formatComparisonRow(["-------", "---------", "-----", "------"]));

  for (const [library] of measuredLibraries) {
    if (library === "@clo4/cli") {
      continue;
    }

    const ourMedians: number[] = [];
    const otherMedians: number[] = [];
    for (const [scenario] of scenarios) {
      const ourMedian = stats(results.get(keyFor("@clo4/cli", scenario))?.selfTimes ?? []).median;
      const otherMedian = stats(results.get(keyFor(library, scenario))?.selfTimes ?? []).median;
      if (Number.isFinite(ourMedian) && Number.isFinite(otherMedian) && ourMedian > 0 && otherMedian > 0) {
        ourMedians.push(ourMedian);
        otherMedians.push(otherMedian);
      }
    }

    const ourMean = geometricMean(ourMedians);
    const otherMean = geometricMean(otherMedians);
    console.log(
      formatComparisonRow([library, fmt(ourMean), fmt(otherMean), comparisonText(ourMean, otherMean)]),
    );
  }
}

function comparisonText(ours: number, other: number): string {
  if (!Number.isFinite(ours) || !Number.isFinite(other) || ours <= 0 || other <= 0) {
    return "n/a";
  }
  const ratio = other / ours;
  if (Math.abs(ratio - 1) < 0.005) {
    return "same speed";
  }
  return ratio > 1 ? `@clo4/cli ${ratio.toFixed(2)}x faster` : `@clo4/cli ${(1 / ratio).toFixed(2)}x slower`;
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

function stats(values: readonly number[]): { median: number; min: number; max: number } {
  if (values.length === 0) {
    return { median: Number.NaN, min: Number.NaN, max: Number.NaN };
  }
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
  return {
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function readPositiveIntOption(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined) {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number.parseInt(raw, 10);
}

function formatRow(cells: readonly string[]): string {
  const widths = [12, 24, 10, 10, 10, 10, 4, 24];
  return cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
}

function formatComparisonRow(cells: readonly string[]): string {
  const widths = [12, 10, 10, 28];
  return cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
}

function createInterruptController(): InterruptController {
  let signal: BenchSignal | undefined;
  let currentChild: ChildProcess | undefined;

  const onSignal = (nextSignal: BenchSignal) => {
    signal ??= nextSignal;
    currentChild?.kill(nextSignal);
  };

  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return {
    get signal() {
      return signal;
    },
    track(child) {
      currentChild = child;
      if (signal !== undefined) {
        child.kill(signal);
      }
    },
    clear(child) {
      if (currentChild === child) {
        currentChild = undefined;
      }
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
      if (!isTty) return;
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
