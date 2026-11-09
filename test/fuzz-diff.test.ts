// Compares the parser and help with the ones at another git ref on random
// specs and command lines, to catch any change in behavior. It only runs when
// FUZZ_AGAINST names a ref, so it's skipped in the normal test run:
//
//   FUZZ_AGAINST=HEAD pnpm fuzz        uncommitted changes against the last commit
//   FUZZ_AGAINST=v2.0.0 pnpm fuzz      this branch against a release
//
// FUZZ_CASES, FUZZ_SEED and FUZZ_CASE work as in test/fuzz.test.ts.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, test, vi } from "vitest";

import type { DidYouMean, ParseError } from "../src/errors.js";
import { getHelp, help, helpCommand, printUsageError } from "../src/help.js";
import type { HelpConfig } from "../src/help.js";
import { usage } from "../src/subcommands.js";
import { parse, readNext } from "../src/parse.js";
import type { Action, ActionInit, NonEmptyArray, Option, Spec, Subcommand } from "../src/types.js";
import { asArray, output } from "../src/util.js";
import { TIMEOUT, caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator, shrink } from "./fuzz/generate.js";
import { attempt, difference, nextDifference } from "./fuzz/snapshot.js";
import type { AnyNextToken } from "./fuzz/snapshot.js";

vi.setConfig({ testTimeout: TIMEOUT });

const ref = process.env.FUZZ_AGAINST;
const dir = ref ? mkdtempSync(join(tmpdir(), "clo4-cli-fuzz-")) : "";
afterAll(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
  }
});

let extracted = false;

/** Import a file of the ref's source. Each file is one module instance, shared by every import of it. */
function load(file: string): Promise<Record<string, unknown>> {
  if (!extracted) {
    const archive = execFileSync("git", ["archive", ref!, "src"], { maxBuffer: 64 * 1024 * 1024 });
    execFileSync("tar", ["-x", "-C", dir], { input: archive });
    extracted = true;
  }
  return import(join(dir, "src", file));
}

test.skipIf(!ref)(`parse and readNext behave the same as at ${ref}`, async () => {
  const theirs = (await load("parse.ts")) as {
    parse: typeof parse;
    readNext?: (spec: Spec, input: readonly string[], partial: string) => AnyNextToken;
  };
  // The built-in usage action moved from help.ts to subcommands.ts.
  const theirSubcommands = (await load("subcommands.ts").catch(() => ({}))) as { usage?: Action };
  const theirUsage = theirSubcommands.usage ?? ((await load("help.ts")) as { usage: Action }).usage;

  // Each copy of the source has its own built-in usage action.
  const sameAction = (x: Action, y: Action) => x === y || (x === usage && y === theirUsage);
  // Specs only get defaults when the other version has them, since an older
  // parser ignores them and would differ on every one.
  const theirsHasDefaults = typeof theirs.parse([], { name: "x" }).defaults === "function";
  // The same goes for persistent subcommands, and for hidden subcommands that
  // only match their exact name.
  const pathLength = (input: string[], spec: Spec) => {
    const outcome = attempt(theirs.parse, input, spec);
    return outcome.ok ? outcome.result.path.length : 0;
  };
  const persistentSpec: Spec = {
    name: "x",
    subcommands: [
      { name: "a", subcommands: [{ name: "b" }] },
      { name: "p", isPersistent: true },
    ],
  };
  const hiddenSpec: Spec = {
    name: "x",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "hidden", hidden: true }],
  };
  const shapes = {
    defaults: theirsHasDefaults,
    persistentSubcommands: pathLength(["a", "p"], persistentSpec) === 3,
    hiddenSubcommands: pathLength(["h"], hiddenSpec) !== 2,
  };
  const differs = (spec: Spec, input: string[], partial: string) => {
    const diff = difference(
      attempt(parse, input, spec),
      attempt(theirs.parse, input, spec),
      sameAction,
      OPTION_NAMES,
    );
    if (diff) {
      return `parse: ${diff}`;
    }
    // Versions before readNext only have `parse` to compare.
    if (!theirs.readNext) {
      return null;
    }
    const next = nextDifference(readNext(spec, input, partial), theirs.readNext(spec, input, partial));
    return next && `readNext: ${next}`;
  };

  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), { emptySeparators: true, ...shapes });
    const spec = gen.spec();
    const input = gen.input(spec);
    const partial = gen.input(spec)[0] ?? "";
    if (differs(spec, input, partial) === null) {
      continue;
    }
    const small = shrink(spec, input, (s, i) => differs(s, i, partial) !== null);
    expect.fail(
      report(
        n,
        small.spec,
        [...small.input, partial],
        `differs from ${ref}, ${differs(small.spec, small.input, partial)}`,
      ),
    );
  }
});

interface HelpModule {
  getHelp: typeof getHelp;
  help: Option;
  helpCommand: Subcommand;
  printUsageError: typeof printUsageError;
  parse: typeof parse;
  output: typeof output;
}

/** What one version writes while `fn` runs, then what it returns or the error it throws. */
function captured(version: HelpModule, fn: () => unknown): string {
  const original = version.output.write;
  let text = "";
  version.output.write = (fd, written) => {
    text += `[${fd}]${written}`;
  };
  try {
    const returned = JSON.stringify(fn());
    return `${text}=> ${returned}`;
  } catch (error) {
    return `${text}threw ${String(error)}`;
  } finally {
    version.output.write = original;
  }
}

/** Every command path from the root of `spec` down its own subcommands. */
function commandPaths(spec: Spec): NonEmptyArray<Subcommand>[] {
  const paths: NonEmptyArray<Subcommand>[] = [];
  const walk = (path: NonEmptyArray<Subcommand>) => {
    paths.push(path);
    for (const sub of path[path.length - 1].subcommands ?? []) {
      walk([...path, sub]);
    }
  };
  walk([spec as Subcommand]);
  return paths;
}

/**
 * What each version shows for `spec` and `input`, one line per thing shown:
 * the help of every command, with and without its description and usage line
 * and with a suggestion for the first token, the built-in help option's and
 * help command's output, and the usage error for the line if it can't be
 * parsed. Spec objects are shared, so only text and return values are
 * compared.
 */
function helpViews(version: HelpModule, spec: Spec, input: string[]): string[] {
  const views: string[] = [];
  const token = input[0] ?? "x";
  for (const path of commandPaths(spec)) {
    const command = path[path.length - 1];
    const choices = [
      ...(command.subcommands ?? []).map((sub) => asArray(sub.name)),
      ...(command.options ?? []).map((option) => asArray(option.name)),
    ];
    const didYouMean: DidYouMean = { input: token, choices };
    const configs: HelpConfig[] = [
      {},
      { description: false, didYouMean },
      { usage: false },
      { description: false, usage: false, didYouMean },
    ];
    for (const config of configs) {
      views.push(captured(version, () => version.getHelp(path, config)));
    }
    views.push(captured(version, () => version.help.action!({ path } as unknown as ActionInit)));
    const helpPath = [...path, version.helpCommand] as NonEmptyArray<Subcommand>;
    const init = {
      path: helpPath,
      args: input,
      help: (o: HelpConfig & { path: NonEmptyArray<Subcommand> }) => version.getHelp(o.path, o),
    };
    views.push(captured(version, () => version.helpCommand.action!(init as unknown as ActionInit)));
  }
  views.push(
    captured(version, () => {
      try {
        return version.parse(input, spec).path.length;
      } catch (error) {
        // Their errors are their own classes, so this can't use instanceof.
        if (typeof error !== "object" || error === null || !("context" in error)) {
          throw error;
        }
        const failure = error as ParseError;
        version.printUsageError(failure.context.path, failure.message, failure.didYouMean);
        return "printed";
      }
    }),
  );
  return views;
}

test.skipIf(!ref)(`help is the same as at ${ref}`, async () => {
  const theirs = {
    ...(await load("help.ts")),
    ...(await load("parse.ts")),
    ...(await load("util.ts")),
  } as unknown as Partial<HelpModule>;
  const missing = (["getHelp", "help", "helpCommand", "printUsageError", "parse", "output"] as const).filter(
    (name) => theirs[name] === undefined,
  );
  if (missing.length > 0) {
    console.warn(`${ref} doesn't export ${missing.join(", ")}, so help isn't compared`);
    return;
  }
  const ours: HelpModule = { getHelp, help, helpCommand, printUsageError, parse, output };

  const differs = (spec: Spec, input: string[]) => {
    const [a, b] = [helpViews(ours, spec, input), helpViews(theirs as HelpModule, spec, input)];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        return `view ${i} differs:\n  ours:   ${JSON.stringify(a[i])}\n  theirs: ${JSON.stringify(b[i])}`;
      }
    }
    return null;
  };

  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), {
      help: true,
      defaults: true,
      persistentSubcommands: true,
      hiddenSubcommands: true,
    });
    const spec = gen.spec();
    const input = gen.input(spec);
    if (differs(spec, input) === null) {
      continue;
    }
    const small = shrink(spec, input, (s, i) => differs(s, i) !== null);
    expect.fail(
      report(n, small.spec, small.input, `help differs from ${ref}, ${differs(small.spec, small.input)}`),
    );
  }
});
