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
import type { Option, Spec, Subcommand } from "../src/types.js";
import * as Testing from "../src/testing.js";
import { asArray, getMinArgs } from "../src/util.js";
import { caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator, shrink } from "./fuzz/generate.js";
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
    if (configured.optionArgSeparators) {
      expected.optionArgSeparators = asArray(configured.optionArgSeparators);
    }
    for (const key of [
      "flagsArePosixNoncompliant",
      "optionsMustPrecedeArguments",
      "subcommandsMatchUniquePrefix",
    ] as const) {
      const value = configured[key];
      if (typeof value === "boolean") {
        expected[key] = value;
      }
    }
  }
  return expected;
}

function invalidPath(path: readonly (Spec | Subcommand)[], spec: Spec): string | null {
  if (path[0] !== spec) {
    return "path doesn't start at the spec";
  }
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
    if (reading.kind !== "options") {
      continue;
    }
    for (const option of reading.options) {
      for (const name of asArray(option.name)) {
        names.add(name);
      }
    }
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
  if (badPath) {
    return badPath;
  }

  const directives = JSON.stringify(next.directives);
  const expected = JSON.stringify(expectedDirectives(path));
  if (directives !== expected) {
    return `directives are ${directives}, expected ${expected}`;
  }

  const strict = attempt(parse, input, spec);
  if (strict.ok) {
    const result = strict.result;
    // Every argument is a whole input token, in order.
    let from = 0;
    for (const arg of result.args) {
      const at = input.indexOf(arg, from);
      if (at === -1) {
        return `argument ${JSON.stringify(arg)} isn't an input token after index ${from}`;
      }
      from = at + 1;
    }
    if (result.argSeparatorIndex > result.args.length) {
      return "argSeparatorIndex is past the arguments";
    }

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
  if (!(error instanceof ParseError)) {
    return `parse threw ${error.name}: ${error.message}`;
  }
  const errorPath = invalidPath(error.context.path as readonly (Spec | Subcommand)[], spec);
  if (errorPath) {
    return `error ${errorPath}`;
  }
  return null;
}

test("readNext and parse keep their invariants on random specs", () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n));
    const spec = gen.spec();
    const input = gen.input(spec);
    if (violation(spec, input) === null) {
      continue;
    }
    const small = shrink(spec, input, (s, i) => violation(s, i) !== null);
    expect.fail(report(n, small.spec, small.input, violation(small.spec, small.input) ?? ""));
  }
});

/** A copy of `value` with every `default` removed. Actions stay the same functions. */
function withoutDefaults<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(withoutDefaults) as T;
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "default") {
      copy[key] = withoutDefaults(item);
    }
  }
  return copy as T;
}

/** The defaults the parser should use for `args` from index `from` on, worked out separately. */
function leadingDefaults(args: Spec["args"], from: number): string[] {
  const values: string[] = [];
  const list = asArray(args);
  for (let i = from; i < list.length && list[i].default !== undefined; i++) {
    values.push(list[i].default!);
  }
  return values;
}

/**
 * The option `name` refers to at the last command on `path`, worked out
 * separately from the parser: the last local option with that name, or else
 * the last persistent one from any command on the path.
 */
function optionNamed(path: readonly (Spec | Subcommand)[], name: string): Option | undefined {
  const named = (option: Option) => asArray(option.name).includes(name);
  const own = path[path.length - 1].options ?? [];
  const local = own.filter((option) => !option.isPersistent && named(option));
  if (local.length > 0) {
    return local[local.length - 1];
  }
  const persistent = path.flatMap((command) =>
    (command.options ?? []).filter((o) => o.isPersistent && named(o)),
  );
  return persistent[persistent.length - 1];
}

/**
 * The first way defaults change a parse other than adding to it, or null.
 * Defaults must not change whether a line parses, the error, the command,
 * which options were used or the separator. They only add positional values
 * after the typed ones, and values of the options that were used. And
 * `defaults(name)` only answers for options that weren't used and whose first
 * argument is required.
 */
function defaultsViolation(spec: Spec, input: string[]): string | null {
  const plain = attempt(parse, input, withoutDefaults(spec));
  const withDefaults = attempt(parse, input, spec);
  if (!plain.ok || !withDefaults.ok) {
    if (plain.ok !== withDefaults.ok) {
      return "defaults change whether the line parses";
    }
    const [a, b] = [plain, withDefaults].map((outcome) => (outcome.ok ? "" : outcome.error.message));
    return a === b ? null : `defaults change the error: ${a} vs ${b}`;
  }
  const typed = plain.result;
  const result = withDefaults.result;
  const names = (path: CommandPathLike) => JSON.stringify(path.map((command) => command.name));
  if (names(typed.path) !== names(result.path)) {
    return "defaults change the command";
  }
  if (typed.argSeparatorIndex !== result.argSeparatorIndex) {
    return "defaults change argSeparatorIndex";
  }
  const keys = (map: Map<string, string[]>) => JSON.stringify([...map.keys()]);
  if (keys(typed.options) !== keys(result.options)) {
    return "defaults change which options were used";
  }
  for (const [name, typedValues] of typed.options) {
    const extra = addedValues(typedValues, result.options.get(name)!);
    if (!extra) {
      return `the values of ${name} don't keep the typed ones in order`;
    }
    const owners = optionsNamed(spec, name);
    const allowed = new Set(owners.flatMap((option) => asArray(option.args).map((arg) => arg.default)));
    const wrong = extra.find((value) => !allowed.has(value));
    if (wrong !== undefined) {
      return `${name} has the value ${JSON.stringify(wrong)}, which isn't typed or a default`;
    }
    // With one option of that name, used once, the values are exactly the
    // typed ones and the defaults of the arguments after them.
    const [only] = owners;
    if (owners.length === 1 && !only.isRepeatable) {
      const expected = [...typedValues, ...leadingDefaults(only.args, typedValues.length)];
      const got = result.options.get(name)!;
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        return `${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`;
      }
    }
  }

  const path = result.path as readonly (Spec | Subcommand)[];
  const command = path[path.length - 1];
  const fills = !command.requiresSubcommand && typed.args.length >= getMinArgs(command.args);
  const expected = [...typed.args, ...(fills ? leadingDefaults(command.args, typed.args.length) : [])];
  if (JSON.stringify(result.args) !== JSON.stringify(expected)) {
    return `args are ${JSON.stringify(result.args)}, expected ${JSON.stringify(expected)}`;
  }

  if (!result.defaults) {
    return "parse has no defaults";
  }
  for (const name of OPTION_NAMES) {
    const got = result.defaults(name);
    const option = result.options.has(name) ? undefined : optionNamed(path, name);
    const first = asArray(option?.args)[0];
    const values = first && !first.isOptional ? leadingDefaults(option!.args, 0) : [];
    const want = values.length > 0 ? values : undefined;
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      return `defaults(${JSON.stringify(name)}) is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`;
    }
  }
  return null;
}

/**
 * The values in `values` that aren't the typed ones, if `typed` is a
 * subsequence of it. Otherwise null.
 */
function addedValues(typed: readonly string[], values: readonly string[]): string[] | null {
  const extra: string[] = [];
  let next = 0;
  for (const value of values) {
    if (next < typed.length && value === typed[next]) {
      next++;
    } else {
      extra.push(value);
    }
  }
  return next === typed.length ? extra : null;
}

/** Every option in `spec` with `name` as one of its names. */
function optionsNamed(spec: Subcommand, name: string): Option[] {
  const found: Option[] = [];
  const visit = (command: Subcommand) => {
    for (const option of command.options ?? []) {
      if (asArray(option.name).includes(name)) {
        found.push(option);
      }
    }
    for (const sub of command.subcommands ?? []) {
      visit(sub);
    }
  };
  visit(spec);
  return found;
}

type CommandPathLike = readonly { name: Spec["name"] | Subcommand["name"] }[];

test("defaults only add to what the user typed", () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), { defaults: true });
    const spec = gen.spec();
    const input = gen.input(spec);
    if (defaultsViolation(spec, input) === null) {
      continue;
    }
    const small = shrink(spec, input, (s, i) => defaultsViolation(s, i) !== null);
    expect.fail(report(n, small.spec, small.input, defaultsViolation(small.spec, small.input) ?? ""));
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
];

/** An option or subcommand that completion offers, but that the parser reads as something else. */
async function offeredButMisread(spec: Spec, before: string[]): Promise<string | null> {
  // The parser can't read every option of a spec that the spec checker rejects.
  try {
    for (const check of specChecks) {
      check(spec);
    }
  } catch {
    return null;
  }
  const offered = new Set((await completeRuntime({ spec, before, partial: "" })).map((c) => c.value));
  const next = readNext(spec, before, "");
  for (const sub of next.subcommands) {
    for (const name of asArray(sub.name)) {
      if (!offered.has(name)) {
        continue;
      }
      const reading = readToken(spec, before, name);
      if (reading.kind !== "subcommand" || reading.command !== sub) {
        return `subcommand ${JSON.stringify(name)} is offered, but isn't read as that subcommand`;
      }
    }
  }
  for (const { option, forms } of next.options) {
    for (const { name, join } of forms) {
      const token = name + (join ?? "");
      if (!offered.has(token)) {
        continue;
      }
      const reading = readToken(spec, before, token);
      if (reading.kind !== "options" || reading.options.length !== 1 || reading.options[0] !== option) {
        return `option ${JSON.stringify(token)} is offered, but isn't read as that option`;
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
    if ((await offeredButMisread(spec, input)) === null) {
      continue;
    }
    expect.fail(report(n, spec, input, (await offeredButMisread(spec, input)) ?? ""));
  }
});
