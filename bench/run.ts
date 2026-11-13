import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { availableParallelism, cpus, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

import { build as rolldownBuild } from "rolldown";

import * as CLI from "../src/index.js";
import {
  clo4WholeSpec,
  largeCommandLine,
  largeGenerators,
  splitGenerators,
  withoutGroupHelp,
} from "./large.js";
import type { LargeCli, LargeShape } from "./large.js";

type Adapter = readonly [library: string, scriptUrl: URL];
type BenchSignal = "SIGINT" | "SIGTERM";

/** The forms a large CLI is written in. See `largeForms`. */
type LargeForm = "large" | "large-split" | "large-whole-spec";

/** The kinds of work a large CLI does. See `largeWorkloads`. */
type LargeWorkload = "command" | "root-help" | "group-help" | "unknown-command";

/** The kinds of work the comparison reports separately. */
type Group = "command" | "help" | "error" | `${LargeForm}:${LargeWorkload}`;

interface Scenario {
  name: string;
  group: Group;
  args: readonly string[];
  /** Checked once per library before timing starts, so a broken adapter fails the run. */
  expected?: Expected;
}

interface Expected {
  /** The exit code, or "non-zero" for any failure. */
  status: number | "non-zero";
  stdout?: string;
  /** Text that stdout or stderr must contain, for output that differs between libraries. */
  includes?: string;
}
type Status = number | string;

interface BenchOptions {
  samples: number;
  warmup: number;
  concurrency: number;
  jsonOut: string | undefined;
}

interface RunResult {
  total: number;
  self: number;
  stdio: number;
  status: Status;
  stdout: string;
  stderr: string;
}

interface Job {
  library: string;
  scenario: Scenario;
  bundle: string;
}

interface Bucket {
  selfTimes: number[];
  stdioTimes: number[];
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
const ours = "@clo4/cli";

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

const baselineAdapter = new URL("../baseline.mjs", import.meta.url);
const completionAdapter = new URL("../clo4-cli-completion.mjs", import.meta.url);

const adapters: readonly Adapter[] = [
  [ours, new URL("../clo4-cli.mjs", import.meta.url)],
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

/** The 7-command CLI's groups, in the order the comparison reports them. */
const groups: readonly { group: Group; title: string }[] = [
  { group: "command", title: "Running a command" },
  { group: "help", title: "Printing help" },
  { group: "error", title: "Usage errors" },
];

/** What every library runs, on the 7-command CLI in each adapter. */
const scenarios: readonly Scenario[] = [
  { name: "top-level --help", group: "help", args: ["--help"], expected: { status: 0 } },
  {
    name: "nested help (3 levels)",
    group: "help",
    args: ["remote", "add", "--help"],
    expected: { status: 0 },
  },
  {
    name: "build variadic + options",
    group: "command",
    args: ["build", "a", "b", "c", "--out", "dist", "--mode", "release", "--watch", "-vv"],
    expected: { status: 0, stdout: "build:a,b,c:dist:release:true:2\n" },
  },
  {
    name: "alias dispatch",
    group: "command",
    args: ["b", "a", "--out", "dist"],
    expected: { status: 0, stdout: "build:a:dist:-:false:0\n" },
  },
  {
    name: "nested dispatch",
    group: "command",
    args: ["remote", "add", "origin", "https://example.com", "--force", "--tag", "v1"],
    expected: { status: 0, stdout: "add:origin:https://example.com:true:v1\n" },
  },
  {
    name: "second group",
    group: "command",
    args: ["config", "set", "key", "value"],
    expected: { status: 0, stdout: "set:key:value\n" },
  },
  // --out is given so that libraries which check required options first still
  // reach their unknown-option check. Cliffy and citty accept the unknown
  // option and run the build, so this isn't checked.
  { name: "unknown option", group: "error", args: ["build", "a", "--out", "dist", "--uot", "x"] },
];

/**
 * The large CLIs, generated for the libraries in bench/large.ts. The cost of
 * building a spec grows with the CLI, and a 7-command CLI hides it.
 */
const largeShapes: readonly { commands: string; shape: LargeShape }[] = [
  { commands: "100", shape: { groups: 10, commands: 10, options: 6 } },
  { commands: "1,000", shape: { groups: 50, commands: 20, options: 6 } },
];

/**
 * The forms each large CLI is written in. Every library with a generator for
 * a form runs each large workload in that form. The whole-spec form has no
 * comparison.
 */
const largeForms: readonly {
  form: LargeForm;
  suffix: string;
  title?: string;
  generators: ReadonlyMap<string, (shape: LargeShape) => LargeCli>;
}[] = [
  { form: "large", suffix: "", title: "A large CLI in one file", generators: largeGenerators },
  {
    form: "large-split",
    suffix: ", a file per group",
    title: "A large CLI with a file per group",
    generators: splitGenerators,
  },
  { form: "large-whole-spec", suffix: ", whole spec", generators: new Map([[ours, clo4WholeSpec]]) },
];

/**
 * What each large CLI runs, each compared in a table of its own: a command
 * near its end, root help, a group's help, and a name that isn't a command.
 * Some libraries load every group to list the groups or look for an alias,
 * so the cost of one kind of work can be far from the others.
 */
const largeWorkloads: readonly {
  workload: LargeWorkload;
  suffix: string;
  title: string;
  scenario: (shape: LargeShape) => Pick<Scenario, "args" | "expected">;
}[] = [
  {
    workload: "command",
    suffix: "",
    title: "running a command",
    scenario(shape) {
      const { args, stdout } = largeCommandLine(shape);
      return { args, expected: { status: 0, stdout } };
    },
  },
  {
    workload: "root-help",
    suffix: ", --help",
    title: "root help",
    scenario: (shape) => ({ args: ["--help"], expected: { status: 0, includes: `g${shape.groups - 1}` } }),
  },
  {
    workload: "group-help",
    suffix: ", group --help",
    title: "a group's help",
    scenario: (shape) => ({
      args: [largeCommandLine(shape).args[0], "--help"],
      expected: { status: 0, includes: `c${shape.commands - 1}` },
    }),
  },
  {
    workload: "unknown-command",
    suffix: ", unknown command",
    title: "an unknown command",
    scenario: () => ({ args: ["nope"], expected: { status: "non-zero", includes: "nope" } }),
  },
];

/** The large CLIs' comparisons, one for each form and kind of work. */
const largeGroups: readonly { group: Group; title: string }[] = largeForms.flatMap(({ form, title }) =>
  title === undefined
    ? []
    : largeWorkloads.map(({ workload, title: work }) => ({
        group: `${form}:${workload}` as const,
        title: `${title}: ${work}`,
      })),
);

const baselineScenario: Scenario = { name: "process startup", group: "command", args: [] };

/** What bash runs on Tab after `forge remote add origin url --`. Only @clo4/cli has it. */
const completionScenario: Scenario = {
  name: "completion",
  group: "command",
  args: [
    "completion",
    "complete",
    "--shell",
    "bash",
    "--gate-options",
    "--",
    "remote",
    "add",
    "origin",
    "url",
    "--",
  ],
};

const spec = CLI.spec({
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
      name: "--json-out",
      description: "Append this run's results to this file as one line of JSON.",
      args: { name: "file" },
    },
  ],
  action({ options }) {
    return runBenchmark({
      samples: readPositiveIntOption(options.get("--samples"), "--samples", 50),
      warmup: readPositiveIntOption(options.get("--warmup"), "--warmup", 3),
      concurrency: readConcurrency(options.get("--concurrency")),
      jsonOut: options.get("--json-out"),
    });
  },
});

CLI.run(spec);

async function runBenchmark({ samples, warmup, concurrency, jsonOut }: BenchOptions): Promise<number> {
  if (!existsSync(new URL("../../dist/index.js", import.meta.url))) {
    console.error("Build @clo4/cli before benchmarking: pnpm build");
    return 1;
  }

  const bundleDir = mkdtempSync(join(tmpdir(), "clo4-cli-bench-compiled-"));

  try {
    const { jobs, libraries, largeScenarios } = await prepareJobs(bundleDir);
    const allScenarios = [...scenarios, ...largeScenarios];
    const interrupt = createInterruptController();
    const results = new Map<string, Bucket>();

    try {
      const failures = await checkOutputs(jobs, interrupt, concurrency, bundleDir);
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
      console.log(
        "`stdio` is the part of `self` Node spent building process.stdout and process.stderr, which",
      );
      console.log("happens the first time anything reads them, such as the first console.log.");
      console.log("`total` is the whole process, timed from outside, so it includes Node's startup.");
      console.log("");

      const progress = createProgress((warmup + samples) * jobs.length);
      for (let i = 0; i < warmup + samples; i += 1) {
        await forEachConcurrent(shuffled(jobs), concurrency, async (job, slot) => {
          const result = await runOnce(
            job.bundle,
            job.scenario.args,
            interrupt,
            join(bundleDir, `timing-${slot}.txt`),
          );
          progress.tick();
          if (i >= warmup) {
            recordResult(bucketFor(results, job.library, job.scenario.name), result);
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
      formatRow([
        "library",
        "scenario",
        "self p50",
        "self p10",
        "self p90",
        "stdio p50",
        "total p50",
        "n",
        "exit codes",
      ]),
    );
    console.log(
      formatRow([
        "-------",
        "--------",
        "--------",
        "--------",
        "--------",
        "---------",
        "---------",
        "-",
        "----------",
      ]),
    );
    for (const job of uniqueJobs(jobs)) {
      printRow(results.get(keyFor(job.library, job.scenario.name)), job.library, job.scenario.name);
    }

    const baseline = median(results, "baseline", baselineScenario.name);
    console.log("");
    console.log("Comparison with @clo4/cli, one table per kind of work. Each library's score is the");
    console.log("geometric mean of its scenario medians in that table. Ratios leave out the time");
    console.log("to load an empty bundle. Lower is better. `stdio` is the mean of its scenario");
    console.log("`stdio` medians.");
    const comparisons = [...groups, ...largeGroups].map(({ group, title }) => {
      const groupScenarios = allScenarios.filter((s) => s.group === group);
      const groupLibraries = libraries.filter((library) =>
        groupScenarios.every((s) => results.has(keyFor(library, s.name))),
      );
      const comparison = compareGroup(results, group, groupScenarios, groupLibraries, baseline);
      printComparison(
        title,
        comparison,
        libraries.filter((library) => !groupLibraries.includes(library)),
      );
      return comparison;
    });

    if (jsonOut !== undefined) {
      const record = {
        ...runInfo(samples, warmup, concurrency),
        results: resultRecords(results, jobs),
        comparisons,
      };
      // Times are in milliseconds, rounded to the microsecond.
      const rounded = (_: string, value: unknown) =>
        typeof value === "number" && !Number.isInteger(value) ? Math.round(value * 1000) / 1000 : value;
      appendFileSync(jsonOut, `${JSON.stringify(record, rounded)}\n`);
      console.log(`\nAppended this run's results to ${jsonOut}`);
    }
  } finally {
    rmSync(bundleDir, { recursive: true, force: true });
  }

  return 0;
}

/**
 * Bundle every adapter and list the timed jobs: the baseline, each library on
 * each scenario, the large CLIs in each form, and @clo4/cli's completion.
 */
async function prepareJobs(
  bundleDir: string,
): Promise<{ jobs: Job[]; libraries: string[]; largeScenarios: Scenario[] }> {
  const bundled = (name: string) => join(bundleDir, `${slug(name)}.mjs`);

  const large = largeForms.flatMap(({ form, suffix: formSuffix, generators }) =>
    adapters
      .filter(([library]) => generators.has(library))
      .flatMap(([library]) =>
        largeShapes.map(({ commands, shape }) => {
          const name = slug(`${form} ${library} ${commands}`);
          const { entry, files } = generators.get(library)!(shape);
          return {
            library,
            scenarios: largeWorkloads
              .filter(({ workload }) => workload !== "group-help" || !withoutGroupHelp.has(library))
              .map(({ workload, suffix, scenario }) => ({
                name: `${commands} commands${formSuffix}${suffix}`,
                group: `${form}:${workload}` as const,
                ...scenario(shape),
              })),
            input: join(benchDir, `${name}.mjs`),
            // A CLI with a file per group gets a directory for its chunks.
            output: files.size > 0 ? join(bundleDir, name, "entry.mjs") : bundled(name),
            entry,
            files,
          };
        }),
      ),
  );

  await Promise.all([
    bundle(fileURLToPath(baselineAdapter), bundled("baseline")),
    bundle(fileURLToPath(completionAdapter), bundled("completion")),
    ...adapters.map(([library, url]) => bundle(fileURLToPath(url), bundled(library))),
    ...large.map(({ input, output, entry, files }) => bundle(input, output, entry, files)),
  ]);

  const jobs: Job[] = [{ library: "baseline", scenario: baselineScenario, bundle: bundled("baseline") }];
  for (const [library] of adapters) {
    for (const scenario of scenarios) {
      jobs.push({ library, scenario, bundle: bundled(library) });
    }
  }
  for (const { library, scenarios: cliScenarios, output } of large) {
    for (const scenario of cliScenarios) {
      jobs.push({ library, scenario, bundle: output });
    }
  }
  jobs.push({ library: ours, scenario: completionScenario, bundle: bundled("completion") });

  return {
    jobs,
    libraries: adapters.map(([library]) => library),
    largeScenarios: [
      ...new Map(large.flatMap(({ scenarios }) => scenarios.map((s) => [s.name, s]))).values(),
    ],
  };
}

/**
 * Bundle `input` to `output`, minified, as a CLI shipped to users would be.
 * With `source`, `input` is a path that needn't exist and `source` is its
 * contents, so a generated adapter's imports resolve from the bench directory.
 * When `files` isn't empty, the adapter imports each of those paths with
 * `import()`, and `output` gets a chunk beside it for each one. Each file
 * resolves to a path in the bench directory, so its own imports resolve from
 * there too.
 */
async function bundle(
  input: string,
  output: string,
  source?: string,
  files?: ReadonlyMap<string, string>,
): Promise<void> {
  const generated = new Map<string, string>();
  if (source !== undefined) {
    generated.set(input, source);
  }
  for (const [path, text] of files ?? []) {
    generated.set(join(dirname(input), path), text);
  }
  await rolldownBuild({
    input,
    platform: "node",
    logLevel: "silent",
    transform: { target: "es2022" },
    plugins:
      source === undefined
        ? []
        : [
            {
              name: "generated-adapter",
              resolveId: (id) => (id === input ? id : files?.has(id) ? join(dirname(input), id) : null),
              load: (id) => generated.get(id) ?? null,
            },
          ],
    output: {
      // Chunks are named .mjs too, so Node doesn't parse each one twice to
      // find out whether it's a module.
      ...(files !== undefined && files.size > 0
        ? { dir: dirname(output), entryFileNames: basename(output), chunkFileNames: "[name]-[hash].mjs" }
        : { file: output, codeSplitting: false }),
      format: "esm",
      sourcemap: false,
      minify: true,
    },
  });
}

/** Each library and scenario once, in the order the jobs list them. */
function uniqueJobs(jobs: readonly Job[]): Job[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const key = keyFor(job.library, job.scenario.name);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** What the run ran on and with, for comparing runs in a history file. */
function runInfo(samples: number, warmup: number, concurrency: number) {
  return {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? "local",
    node: process.version,
    cpu: cpus()[0]?.model ?? "unknown",
    samples,
    warmup,
    concurrency,
  };
}

/** Each library and scenario's measurements, in milliseconds. */
function resultRecords(results: Map<string, Bucket>, jobs: readonly Job[]) {
  return uniqueJobs(jobs).map(({ library, scenario }) => {
    const bucket = results.get(keyFor(library, scenario.name));
    const self = bucket?.selfTimes ?? [];
    return {
      library,
      scenario: scenario.name,
      group: scenario.group,
      self: { p10: percentile(self, 0.1), p50: percentile(self, 0.5), p90: percentile(self, 0.9) },
      stdio: percentile(bucket?.stdioTimes ?? [], 0.5),
      total: percentile(bucket?.totalTimes ?? [], 0.5),
      n: self.length,
      missing: bucket?.missing ?? 0,
      statuses: Object.fromEntries(bucket?.statuses ?? []),
    };
  });
}

/**
 * Run each job that has an expected result once, and return a description of
 * every mismatch.
 */
async function checkOutputs(
  jobs: readonly Job[],
  interrupt: InterruptController,
  concurrency: number,
  timingDir: string,
): Promise<string[]> {
  const failures: string[] = [];
  const checks = uniqueJobs(jobs).filter((job) => job.scenario.expected !== undefined);
  await forEachConcurrent(checks, concurrency, async ({ library, bundle, scenario }, slot) => {
    const expected = scenario.expected!;
    const result = await runOnce(bundle, scenario.args, interrupt, join(timingDir, `timing-${slot}.txt`));
    const statusMatches =
      expected.status === "non-zero" ? result.status !== 0 : result.status === expected.status;
    if (!statusMatches) {
      failures.push(`${library}, ${scenario.name}: exited ${result.status}, expected ${expected.status}`);
    } else if (expected.stdout !== undefined && result.stdout !== expected.stdout) {
      failures.push(
        `${library}, ${scenario.name}: printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(expected.stdout)}`,
      );
    } else if (
      expected.includes !== undefined &&
      !`${result.stdout}${result.stderr}`.includes(expected.includes)
    ) {
      failures.push(`${library}, ${scenario.name}: didn't print ${JSON.stringify(expected.includes)}`);
    }
  });
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
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

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
        stdio: Number.NaN,
        status: basename(error.name),
        stdout,
        stderr,
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

      let timing = { self: Number.NaN, stdio: Number.NaN };
      try {
        timing = JSON.parse(readFileSync(timingFile, "utf8")) as typeof timing;
      } catch {
        // Child exited before writing a timing sample.
      }
      resolve({
        total: performance.now() - start,
        self: timing.self,
        stdio: timing.stdio,
        status: code ?? signal ?? "signal",
        stdout,
        stderr,
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
    stdioTimes: [],
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
    bucket.stdioTimes.push(result.stdio);
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
      fmt(percentile(bucket?.stdioTimes ?? [], 0.5)),
      fmt(percentile(total, 0.5)),
      String(total.length),
      bucket !== undefined && bucket.missing > 0
        ? `${statusCells} (!${bucket.missing} no-timing)`
        : statusCells,
    ]),
  );
}

interface GroupComparison {
  group: Group;
  scenarios: string[];
  /** The time to load an empty bundle, left out of the ratios. */
  baseline: number;
  ours: { geomean: number; stdio: number };
  libraries: {
    library: string;
    geomean: number;
    stdio: number;
    difference: number;
    low: number;
    high: number;
    result: string;
  }[];
}

/**
 * Compare each of `libraries` with @clo4/cli by the geometric mean of its
 * medians on `groupScenarios`. The interval comes from resampling each
 * scenario's measurements (a bootstrap): when it includes zero, the run can't
 * tell the two apart. Ratios leave out `baseline`, the cost of importing any
 * file, which every library pays and which would otherwise pull every ratio
 * towards 1.
 */
function compareGroup(
  results: Map<string, Bucket>,
  group: Group,
  groupScenarios: readonly Scenario[],
  libraries: readonly string[],
  baseline: number,
): GroupComparison {
  const random = mulberry32(0x5eed);
  const resamples = 1000;
  const samplesFor = (library: string): number[][] =>
    groupScenarios.map((s) => results.get(keyFor(library, s.name))?.selfTimes ?? []);
  const geomeanOfMedians = (cells: readonly (readonly number[])[]): number =>
    geometricMean(cells.map((cell) => percentile(cell, 0.5)));
  const resampledGeomeans = (cells: readonly (readonly number[])[]): number[] =>
    Array.from({ length: resamples }, () =>
      geomeanOfMedians(cells.map((cell) => cell.map(() => cell[Math.floor(random() * cell.length)]))),
    );
  const stdioMean = (library: string): number =>
    groupScenarios.reduce(
      (sum, s) => sum + percentile(results.get(keyFor(library, s.name))?.stdioTimes ?? [], 0.5),
      0,
    ) / groupScenarios.length;

  const ourCells = samplesFor(ours);
  const ourMean = geomeanOfMedians(ourCells);
  const ourResampled = resampledGeomeans(ourCells);

  return {
    group,
    scenarios: groupScenarios.map((s) => s.name),
    baseline,
    ours: { geomean: ourMean, stdio: stdioMean(ours) },
    libraries: libraries
      .filter((library) => library !== ours)
      .map((library) => {
        const mean = geomeanOfMedians(samplesFor(library));
        const differences = resampledGeomeans(samplesFor(library)).map(
          (value, index) => value - ourResampled[index],
        );
        const low = percentile(differences, 0.025);
        const high = percentile(differences, 0.975);
        return {
          library,
          geomean: mean,
          stdio: stdioMean(library),
          difference: mean - ourMean,
          low,
          high,
          result: comparisonText(ourMean - baseline, mean - baseline, low, high),
        };
      }),
  };
}

/** Print a comparison, then the libraries in `missing`, which have no CLI for it. */
function printComparison(title: string, comparison: GroupComparison, missing: readonly string[]): void {
  const count = comparison.scenarios.length;
  console.log("");
  console.log(`${title} (${count} ${count === 1 ? "scenario" : "scenarios"})`);
  console.log(`@clo4/cli: ${fmt(comparison.ours.geomean)}, stdio ${fmt(comparison.ours.stdio)}`);
  console.log(formatComparisonRow(["library", "geomean", "stdio", "difference (95% interval)", "result"]));
  console.log(formatComparisonRow(["-------", "-------", "-----", "-------------------------", "------"]));
  for (const row of comparison.libraries) {
    console.log(
      formatComparisonRow([
        row.library,
        fmt(row.geomean),
        fmt(row.stdio),
        `${signed(row.difference)} (${signed(row.low)} to ${signed(row.high)})`,
        row.result,
      ]),
    );
  }
  if (missing.length > 0) {
    console.log(`Not in this table: ${missing.join(", ")}`);
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
  const ratio = other > ours ? other / ours : ours / other;
  return `@clo4/cli ${other > ours ? "faster" : "slower"} (${ratio.toFixed(ratio < 2 ? 2 : 1)}x)`;
}

/** The median `self` time of `library` on `scenario`, or NaN if it wasn't run. */
function median(results: Map<string, Bucket>, library: string, scenario: string): number {
  return percentile(results.get(keyFor(library, scenario))?.selfTimes ?? [], 0.5);
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
  const widths = [19, 50, 10, 10, 10, 10, 10, 4, 24];
  return cells.map((cell, index) => cell.padEnd(widths[index])).join("  ");
}

function formatComparisonRow(cells: readonly string[]): string {
  const widths = [19, 10, 10, 32, 28];
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
