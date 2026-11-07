// Properties every spec and command line should satisfy, checked on random
// ones. A failure prints a shrunk spec and input, plus the environment
// variables that rerun just that case (see test/fuzz/cases.ts).
//
// `pnpm fuzz` runs this file and test/fuzz-diff.test.ts. Raise FUZZ_CASES for
// a longer search, e.g. `FUZZ_CASES=200000 pnpm fuzz`.

import { expect, test } from "vitest";

import { completeRuntime } from "../src/completion.js";
import { ParseError } from "../src/errors.js";
import type { Directives } from "../src/directives.js";
import { parse, readNext, readToken } from "../src/parse.js";
import type { NextToken } from "../src/parse.js";
import type { Spec, Subcommand } from "../src/types.js";
import * as Testing from "../src/testing.js";
import { asArray } from "../src/util.js";
import { caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { generator, shrink } from "./fuzz/generate.js";
import { attempt } from "./fuzz/snapshot.js";

/** What the directives should be after following `path`, worked out separately from the parser. */
function expectedDirectives(path: readonly (Spec | Subcommand)[]): Directives {
  const expected: Directives = {
    optionArgSeparators: ["="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: false,
  };
  for (const command of path) {
    const configured = command.parserDirectives ?? {};
    if (configured.optionArgSeparators)
      expected.optionArgSeparators = asArray(configured.optionArgSeparators);
    for (const key of [
      "flagsArePosixNoncompliant",
      "optionsMustPrecedeArguments",
      "subcommandsMatchUniquePrefix",
    ] as const) {
      const value = configured[key];
      if (typeof value === "boolean") expected[key] = value;
    }
  }
  return expected;
}

function invalidPath(path: readonly (Spec | Subcommand)[], spec: Spec): string | null {
  if (path[0] !== spec) return "path doesn't start at the spec";
  for (let i = 1; i < path.length; i++) {
    if (!path[i - 1].subcommands?.includes(path[i] as Subcommand)) {
      return `path[${i}] isn't a subcommand of path[${i - 1}]`;
    }
  }
  return null;
}

/** The names of every option the lenient read uses, token by token. */
function usedNames(spec: Spec, input: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const reading = readToken(spec, input.slice(0, i), input[i]);
    if (reading.kind !== "options") continue;
    for (const option of reading.options) for (const name of asArray(option.name)) names.add(name);
  }
  return names;
}

/** The first property that `readNext` or `parse` breaks for this spec and input, or null. */
function violation(spec: Spec, input: string[]): string | null {
  let next: NextToken;
  try {
    next = readNext(spec, input, "");
  } catch (error) {
    return `readNext threw ${String(error)}`;
  }

  const path = next.path as readonly (Spec | Subcommand)[];
  const badPath = invalidPath(path, spec);
  if (badPath) return badPath;

  const directives = JSON.stringify(next.directives);
  const expected = JSON.stringify(expectedDirectives(path));
  if (directives !== expected) return `directives are ${directives}, expected ${expected}`;

  const strict = attempt(parse, input, spec);
  if (strict.ok) {
    const result = strict.result;
    // Every argument is a whole input token, in order.
    let from = 0;
    for (const arg of result.args) {
      const at = input.indexOf(arg, from);
      if (at === -1) return `argument ${JSON.stringify(arg)} isn't an input token after index ${from}`;
      from = at + 1;
    }
    if (result.argSeparatorIndex > result.args.length) return "argSeparatorIndex is past the arguments";

    // The lenient read used for completion agrees with the parse.
    if (result.path.length !== path.length || result.path.some((command, i) => command !== path[i])) {
      return "readNext and parse end at different commands";
    }
    const seenNames = [...usedNames(spec, input)].sort();
    const parsedNames = [...result.options.keys()].sort();
    if (JSON.stringify(seenNames) !== JSON.stringify(parsedNames)) {
      return `readNext saw options named ${JSON.stringify(seenNames)}, but parse has ${JSON.stringify(parsedNames)}`;
    }
    return null;
  }

  const error = strict.error;
  if (!(error instanceof ParseError)) return `parse threw ${error.name}: ${error.message}`;
  const errorPath = invalidPath(error.context.path as readonly (Spec | Subcommand)[], spec);
  if (errorPath) return `error ${errorPath}`;
  return null;
}

test("readNext and parse keep their invariants on random specs", () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n));
    const spec = gen.spec();
    const input = gen.input(spec);
    if (violation(spec, input) === null) continue;
    const small = shrink(spec, input, (s, i) => violation(s, i) !== null);
    expect.fail(report(n, small.spec, small.input, violation(small.spec, small.input) ?? ""));
  }
});

test("completion never throws on random specs", async () => {
  // Completion is slower and async, so it gets a tenth of the cases.
  for (const n of caseNumbers(10)) {
    const gen = generator(caseSeed(n));
    const spec = gen.spec();
    const before = gen.input(spec);
    const partial = gen.input(spec)[0] ?? "";
    try {
      await completeRuntime({ spec, before, partial, gateOptions: gen.random.chance(0.5) });
    } catch (error) {
      expect.fail(report(n, spec, [...before, partial], `completion threw: ${String(error)}`));
    }
  }
});

const specChecks = [
  Testing.assertNamesReadBack,
  Testing.assertOptionsHaveLocallyUniqueNames,
  Testing.assertSubcommandsHaveLocallyUniqueNames,
  Testing.assertPlusMinusOptionsTakeOneArg,
];

/** An option or subcommand that completion offers, but that the parser reads as something else. */
async function offeredButMisread(spec: Spec, before: string[]): Promise<string | null> {
  // The parser can't read every option of a spec that the spec checker rejects.
  try {
    for (const check of specChecks) check(spec);
  } catch {
    return null;
  }
  const offered = new Set((await completeRuntime({ spec, before, partial: "" })).map((c) => c.value));
  const next = readNext(spec, before, "");
  for (const sub of next.subcommands) {
    for (const name of asArray(sub.name)) {
      if (!offered.has(name)) continue;
      const reading = readToken(spec, before, name);
      if (reading.kind !== "subcommand" || reading.command !== sub) {
        return `subcommand ${JSON.stringify(name)} is offered, but isn't read as that subcommand`;
      }
    }
  }
  for (const { option, names, separator } of next.options) {
    for (const name of names) {
      // An option named "-" or "+" only takes a value attached to it, like `-5`.
      if (!offered.has(name + (separator ?? "")) || name === "-" || name === "+") continue;
      const reading = readToken(spec, before, name);
      if (reading.kind !== "options" || reading.options.length !== 1 || reading.options[0] !== option) {
        return `option ${JSON.stringify(name)} is offered, but isn't read as that option`;
      }
    }
  }
  return null;
}

test("completion only offers options and subcommands the parser reads as such", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n));
    const spec = gen.spec();
    const input = gen.input(spec);
    if ((await offeredButMisread(spec, input)) === null) continue;
    expect.fail(report(n, spec, input, (await offeredButMisread(spec, input)) ?? ""));
  }
});
