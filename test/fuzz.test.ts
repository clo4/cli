// Properties every spec and command line should satisfy, checked on random
// ones. A failure prints a shrunk spec and input, plus the environment
// variables that rerun just that case (see test/fuzz/cases.ts).
//
// `pnpm fuzz` runs this file and test/fuzz-diff.test.ts. Raise FUZZ_CASES for
// a longer search, e.g. `FUZZ_CASES=200000 pnpm fuzz`.

import { expect, test } from "vitest";

import { completeRuntime } from "../src/completion.js";
import { ParseError } from "../src/errors.js";
import { getMaxArgs, readNext, scan } from "../src/parse.js";
import type { Directives } from "../src/parse.js";
import type { Spec, Subcommand } from "../src/types.js";
import * as Testing from "../src/testing.js";
import { asArray } from "../src/util.js";
import { caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { generator, shrink } from "./fuzz/generate.js";
import { attempt, difference } from "./fuzz/snapshot.js";

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

/** The first property that `scan` breaks for this spec and input, or null. */
function violation(spec: Spec, input: string[]): string | null {
  const lenient = attempt(scan, input, spec, false);
  if (!lenient.ok) return `lenient scan threw ${lenient.error.name}: ${lenient.error.message}`;
  const result = lenient.result;

  const path = result.path as (Spec | Subcommand)[];
  const badPath = invalidPath(path, spec);
  if (badPath) return badPath;

  // Every argument is a whole input token, in order.
  let from = 0;
  for (const arg of result.args) {
    const at = input.indexOf(arg, from);
    if (at === -1) return `argument ${JSON.stringify(arg)} isn't an input token after index ${from}`;
    from = at + 1;
  }
  if (result.argSeparatorIndex > result.args.length) return "argSeparatorIndex is past the arguments";

  const seenNames = new Set(result.seenOptions.flatMap((option) => asArray((option as Spec).name)));
  for (const name of result.options.keys()) {
    if (!seenNames.has(name)) return `options has ${name}, which no seen option is called`;
  }

  if (result.openOption) {
    const { option, valueCount } = result.openOption as { option: Spec; valueCount: number };
    if (valueCount >= getMaxArgs(option.args)) return "openOption has no room for another value";
  }

  const directives = JSON.stringify(result.directives);
  const expected = JSON.stringify(expectedDirectives(path));
  if (directives !== expected) return `directives are ${directives}, expected ${expected}`;

  const strict = attempt(scan, input, spec, true);
  if (strict.ok) {
    const diff = difference(strict, lenient);
    return diff ? `strict and lenient scans disagree: ${diff}` : null;
  }

  const error = strict.error;
  if (!(error instanceof ParseError)) return `strict scan threw ${error.name}: ${error.message}`;
  const errorPath = invalidPath(error.context.path as readonly (Spec | Subcommand)[], spec);
  if (errorPath) return `error ${errorPath}`;
  if (typeof error.index === "number") {
    const { index, start, end } = error as unknown as { index: number; start?: number; end?: number };
    if (index < 0 || index >= input.length) return `${error.name} index ${index} is outside the input`;
    const token = input[index];
    if (start !== undefined && end !== undefined && !(0 <= start && start <= end && end <= token.length)) {
      return `${error.name} span ${start}-${end} is outside ${JSON.stringify(token)}`;
    }
    if ("arg" in error && error.arg !== token.slice(start, end)) {
      return `${error.name} arg ${JSON.stringify(error.arg)} isn't its span of ${JSON.stringify(token)}`;
    }
    if ("value" in error && error.value !== token) {
      return `${error.name} value ${JSON.stringify(error.value)} isn't the token ${JSON.stringify(token)}`;
    }
  }
  return null;
}

test("scan keeps its invariants on random specs", () => {
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
  Testing.assertLongOptionNamesDoNotStartWithSingleDash,
  Testing.assertOptionNamesStartWithDashes,
  Testing.assertOptionsHaveLocallyUniqueNames,
  Testing.assertSubcommandsHaveLocallyUniqueNames,
  Testing.assertNothingIsNamedDashDash,
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
  const seen = next.seenOptions.length;
  const depth = next.path.length;
  const readAfter = (token: string) => scan([...before, token], spec, false);
  for (const sub of next.subcommands) {
    for (const name of asArray(sub.name)) {
      if (!offered.has(name)) continue;
      const result = readAfter(name);
      if (result.path.length !== depth + 1 || result.path[depth] !== sub) {
        return `subcommand ${JSON.stringify(name)} is offered, but isn't read as that subcommand`;
      }
    }
  }
  const { local, persistent } = next.scope.visible();
  for (const { option, names } of [...local, ...persistent]) {
    const sep = next.scope.requiredSeparator(option) ?? "";
    for (const name of names) {
      // An option named "-" or "+" only takes a value attached to it, like
      // `-5`. A name a subcommand matches is offered as that subcommand.
      if (!offered.has(name + sep) || name === "-" || name === "+" || next.subcommandFor(name)) continue;
      const result = readAfter(name);
      if (
        result.path.length !== depth ||
        result.seenOptions.length !== seen + 1 ||
        result.seenOptions[seen] !== option
      ) {
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
