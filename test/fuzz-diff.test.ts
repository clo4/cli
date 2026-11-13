// Compares this version with the one at another git ref on random specs and
// command lines, to catch any change in behavior. It only runs when
// FUZZ_AGAINST names a ref, so it's skipped in the normal test run:
//
//   FUZZ_AGAINST=HEAD pnpm fuzz        uncommitted changes against the last commit
//   FUZZ_AGAINST=v2.0.0 pnpm fuzz      this branch against a release
//
// The other version is a bundle of its `src/index.ts`, and both versions are
// only used through what that file exports: `run`, `help`, `helpCommand` and
// `completion`. What's compared is what a user of the package can see: the
// exit code, what's printed, and what each action receives. So the files
// under `src` can be moved and renamed without breaking the comparison.
//
// FUZZ_CASES, FUZZ_SEED and FUZZ_CASE work as in test/fuzz.test.ts.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "rolldown";
import { afterAll, expect, test, vi } from "vitest";

import * as ours from "../src/index.js";
import type { Action, ActionInit, Option, OptionArgs, Spec, Subcommand } from "../src/types.js";
import { TIMEOUT, caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator, shrink } from "./fuzz/generate.js";
import type { GenerateOptions } from "./fuzz/generate.js";
import { optionEntries } from "./fuzz/snapshot.js";

// Each case runs several command lines through both versions.
vi.setConfig({ testTimeout: TIMEOUT * 20 });

const ref = process.env.FUZZ_AGAINST;
const dir = ref ? mkdtempSync(join(tmpdir(), "clo4-cli-fuzz-")) : "";
afterAll(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** What `src/index.ts` exports that the comparison uses, at any version. */
interface Library {
  run(spec: Spec, ...rest: unknown[]): Promise<number>;
  help: Option;
  helpCommand: Subcommand;
  completion: Subcommand;
}

/** One version of the library, with `run` called the way that version takes its command line. */
interface Version {
  library: Library;
  run(spec: Spec, argv: readonly string[]): Promise<number>;
}

// Capturing {{{

interface WriteSyncFs {
  writeSync(fd: number, data: Uint8Array | string, offset?: number, length?: number): number;
}
// Every version writes with `writeSync` on this object, which Node shares
// between everything that asks for the module.
const fs = (process as unknown as { getBuiltinModule(id: string): WriteSyncFs }).getBuiltinModule("node:fs");

/** What the recording actions were given during the run being captured. */
let received: string[] = [];

/**
 * What a user sees of `run`: everything written to stdout and stderr, then
 * the exit code or the error, then what each action that ran received.
 */
async function captured(run: () => Promise<number>): Promise<string> {
  const writeSync = fs.writeSync;
  const exitCode = process.exitCode;
  let text = "";
  fs.writeSync = (fd, data, offset = 0, length?: number) => {
    if (fd !== 1 && fd !== 2) {
      return writeSync(fd, data, offset, length);
    }
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    const written = bytes.subarray(offset, length === undefined ? undefined : offset + length);
    text += `[${fd}]${new TextDecoder().decode(written)}`;
    return written.length;
  };
  received = [];
  let outcome: string;
  try {
    outcome = `=> ${await run()}`;
  } catch (error) {
    outcome = `threw ${String(error)}`;
  } finally {
    fs.writeSync = writeSync;
    // A version whose `run` sets the exit code mustn't fail the test run.
    process.exitCode = exitCode;
  }
  return [text + outcome, ...received].join("\n");
}

/** A value the spec allows alone or in a list, as a list. */
function list<T>(value: T | readonly T[] | undefined): readonly T[] {
  return value === undefined ? [] : ([value].flat() as T[]);
}

const recorders = new WeakSet<Action>();

/** What `fn` returns, or the error it throws, as text. */
function attempted(fn: () => unknown): unknown {
  try {
    return fn();
  } catch (error) {
    return `threw ${String(error)}`;
  }
}

/**
 * An action that records what it's given: the path, the arguments, every
 * option's values as stored and as `has`, `get`, `all` and `count` give them,
 * and the help of the selected command with and without its description and
 * usage line and with a suggestion. It keeps the name of the action it
 * replaces, which is how a failure shows which action ran.
 */
function recorder(name: string): Action {
  const record = (init: ActionInit): void => {
    // Before actions were given `OptionArgs`, they were given the map.
    const options = init.options as OptionArgs | Map<string, string[]>;
    const command = init.path[init.path.length - 1];
    const didYouMean = {
      input: init.args[0] ?? "x",
      choices: [
        ...list(command.subcommands).map((subcommand) => subcommand.name),
        ...list(command.options).map((option) => option.name),
      ],
    };
    received.push(
      JSON.stringify({
        action: name,
        path: init.path.map((entry) => entry.name),
        args: init.args,
        argSeparatorIndex: init.argSeparatorIndex,
        options: optionEntries(options instanceof Map ? options : options.options),
        answers:
          options instanceof Map
            ? null
            : OPTION_NAMES.map((option) => [
                options.has(option),
                options.get(option),
                // Before `all` gave an empty list for an unused option without defaults, it gave undefined.
                (options.all(option) as string[] | undefined) ?? [],
                options.count(option),
              ]),
        help: [
          {},
          { description: false, didYouMean },
          { usage: false },
          { description: false, usage: false, didYouMean },
        ].map((config) => attempted(() => init.help(config))),
      }),
    );
  };
  const action = Object.defineProperty(record, "name", { value: name }) as Action;
  recorders.add(action);
  return action;
}

/** Replace every action in `command` and below with a {@link recorder}, in place. */
function record(command: Spec | Subcommand): void {
  const replace = (item: { action?: Action }) => {
    if (item.action && !recorders.has(item.action)) {
      item.action = recorder(item.action.name);
    }
  };
  replace(command);
  list(command.options).forEach(replace);
  list(command.subcommands).forEach(record);
}

// }}}

// Versions {{{

/**
 * Wrap `library` so `run` takes the command line the way that version does:
 * as its second argument, or as the `argv` option.
 */
async function versionOf(library: Library): Promise<Version> {
  let given: readonly string[] = [];
  const probe: Spec = {
    name: "x",
    args: { name: "a", isOptional: true, isVariadic: true },
    action: ({ args }) => void (given = args),
  };
  const withOptions: Version["run"] = (spec, argv) => library.run(spec, { argv, setExitCode: false });
  await captured(() => withOptions(probe, ["probe"]));
  return { library, run: given[0] === "probe" ? withOptions : (spec, argv) => library.run(spec, argv) };
}

let theirs: Promise<Version> | undefined;

/** The version at the ref, bundled from its `src/index.ts`. Built once for every test here. */
function theirVersion(): Promise<Version> {
  return (theirs ??= (async () => {
    const archive = execFileSync("git", ["archive", ref!, "src"], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    const file = join(dir, "index.mjs");
    await build({
      input: join(dir, "src", "index.ts"),
      platform: "node",
      logLevel: "silent",
      output: { file, format: "esm", codeSplitting: false, sourcemap: false },
    });
    return versionOf((await import(pathToFileURL(file).href)) as Library);
  })());
}

/**
 * Run a spec made for each version on the same command line, and say how what
 * a user sees differs, or return null if it's the same. `specFor` gives each
 * version its own copy of the built-ins, like its own `helpCommand`.
 */
async function difference(
  versions: readonly [Version, Version],
  specFor: (version: Version) => Spec,
  argv: readonly string[],
): Promise<string | null> {
  const [a, b] = [
    await captured(() => versions[0].run(specFor(versions[0]), argv)),
    await captured(() => versions[1].run(specFor(versions[1]), argv)),
  ];
  return a === b
    ? null
    : `${JSON.stringify(argv)} differs:\n  ours:   ${JSON.stringify(a)}\n  theirs: ${JSON.stringify(b)}`;
}

/** The first of `lines` that the versions differ on, as {@link difference} describes it. */
async function firstDifference(
  versions: readonly [Version, Version],
  specFor: (version: Version) => Spec,
  lines: readonly (readonly string[])[],
): Promise<string | null> {
  for (const argv of lines) {
    const problem = await difference(versions, specFor, argv);
    if (problem) {
      return problem;
    }
  }
  return null;
}

/** Whether `argv` runs an action of `spec` at a path of `length` commands in `version`. */
async function reaches(
  version: Version,
  spec: Spec,
  argv: readonly string[],
  length: number,
): Promise<boolean> {
  record(spec);
  await captured(() => version.run(spec, argv));
  return received.some((line) => (JSON.parse(line) as { path: unknown[] }).path.length === length);
}

/**
 * What the random specs can have without the two versions differing on every
 * one, because the other version doesn't have the feature or has it another
 * way.
 */
async function sharedShapes(theirs: Version): Promise<GenerateOptions & { rules: boolean }> {
  const defaults: Spec = {
    name: "x",
    args: { name: "a", isOptional: true, default: "d" },
    action: () => {},
  };
  const persistent: Spec = {
    name: "x",
    subcommands: [
      { name: "a", subcommands: [{ name: "b" }] },
      { name: "p", isPersistent: true, action: () => {} },
    ],
  };
  const hidden: Spec = {
    name: "x",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "hidden", hidden: true, action: () => {} }],
  };
  // A rule that names an option the command can't use only counts in versions
  // that look the name up among every option on the line.
  const rules: Spec = {
    name: "x",
    options: [{ name: "--root" }],
    subcommands: [{ name: "sub", options: [{ name: "--x", exclusiveOn: ["--root"] }], action: () => {} }],
  };
  record(defaults);
  return {
    defaults: (await captured(() => theirs.run(defaults, []))).includes('"args":["d"]'),
    persistentSubcommands: await reaches(theirs, persistent, ["a", "p"], 3),
    hiddenSubcommands: !(await reaches(theirs, hidden, ["h"], 2)),
    rules: await reaches(theirs, rules, ["--root", "sub", "--x"], 2),
  };
}

/** A copy of `value` without any `dependsOn` or `exclusiveOn`. Actions stay the same functions. */
function withoutRules<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutRules) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "dependsOn" && key !== "exclusiveOn") {
      copy[key] = withoutRules(item);
    }
  }
  return copy as T;
}

// }}}

/**
 * Run every case: make a spec and a command line, and fail with the smallest
 * spec and line that `differs` still describes a difference for.
 */
async function compare(
  shapes: GenerateOptions & { rules: boolean },
  differs: (spec: Spec, input: string[], partial: string) => Promise<string | null>,
): Promise<void> {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), shapes);
    const spec = shapes.rules ? gen.spec() : withoutRules(gen.spec());
    const input = gen.input(spec);
    const partial = gen.input(spec)[0] ?? "";
    if ((await differs(spec, input, partial)) === null) {
      continue;
    }
    const small = await shrink(spec, input, async (s, i) => (await differs(s, i, partial)) !== null);
    expect.fail(
      report(
        n,
        small.spec,
        small.input,
        `differs from ${ref}: ${await differs(small.spec, small.input, partial)}`,
      ),
    );
  }
}

test.skipIf(!ref)(`run does the same as at ${ref}`, async () => {
  const versions = [await versionOf(ours), await theirVersion()] as const;
  const shapes = await sharedShapes(versions[1]);
  await compare({ emptySeparators: true, ...shapes }, (spec, input) => {
    record(spec);
    return difference(versions, () => spec, input);
  });
});

/** The tokens that name each command from the root of `spec` down its own subcommands, by first name. */
function commandLines(spec: Spec): string[][] {
  const lines: string[][] = [];
  const walk = (command: Spec | Subcommand, tokens: string[]) => {
    lines.push(tokens);
    for (const subcommand of list(command.subcommands)) {
      // Shrinking a failing spec can leave a command with no names.
      walk(subcommand, [...tokens, list(subcommand.name)[0] ?? ""]);
    }
  };
  walk(spec, []);
  return lines;
}

test.skipIf(!ref)(`help is the same as at ${ref}`, async () => {
  const versions = [await versionOf(ours), await theirVersion()] as const;
  const shapes = await sharedShapes(versions[1]);
  // Each version's own help option and help command, under names no random
  // spec uses. The line with the option asks for the help of each command,
  // and the line with the command follows the input as names.
  const withHelp = (spec: Spec, { library }: Version): Spec => ({
    ...spec,
    options: [{ ...library.help, name: "--zz-help" }, ...list(spec.options)],
    subcommands: [{ ...library.helpCommand, name: "zz-help" }, ...list(spec.subcommands)],
  });
  await compare({ ...shapes, help: true }, (spec, input) => {
    record(spec);
    return firstDifference(versions, (version) => withHelp(spec, version), [
      ...commandLines(spec).map((tokens) => [...tokens, "--zz-help"]),
      ["zz-help", ...input],
      input,
    ]);
  });
});

test.skipIf(!ref)(`completion offers the same as at ${ref}`, async () => {
  const versions = [await versionOf(ours), await theirVersion()] as const;
  const shapes = await sharedShapes(versions[1]);
  const withCompletion = (spec: Spec, { library }: Version): Spec => ({
    ...spec,
    subcommands: [library.completion, ...list(spec.subcommands)],
  });
  // Versions before the `complete` command have nothing to ask.
  const probe: Spec = { name: "x", options: [{ name: "--probe" }] };
  const asked = await captured(() =>
    versions[1].run(withCompletion(probe, versions[1]), ["completion", "complete", "--", ""]),
  );
  if (!asked.includes("--probe")) {
    console.warn(`${ref} has no completion complete command, so completion isn't compared`);
    return;
  }
  await compare(shapes, (spec, input, partial) => {
    record(spec);
    return firstDifference(versions, (version) => withCompletion(spec, version), [
      ["completion", "complete", "--", ...input, partial],
      ["completion", "complete", "--gate-options", "--", ...input, partial],
    ]);
  });
});
