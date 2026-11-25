// Properties every spec and command line should satisfy, checked on random
// ones. A failure prints a shrunk spec and input, plus the environment
// variables that rerun just that case (see test/fuzz/cases.ts).
//
// `pnpm fuzz` runs this file and test/fuzz-diff.test.ts. Raise FUZZ_CASES for
// a longer search, e.g. `FUZZ_CASES=200000 pnpm fuzz`.

import { expect, test, vi } from "vitest";

import { complete } from "../src/complete.js";
import { ParseError } from "../src/errors.js";
import { parse, readNext, tokenReader } from "../src/parse.js";
import type { NextToken } from "../src/parse.js";
import { formStart } from "../src/scope.js";
import type { Directives } from "../src/scope.js";
import type { Option, Spec, Subcommand } from "../src/types.js";
import { minArgs } from "../src/args.js";
import { asArray } from "../src/util.js";
import { TIMEOUT, caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator, shrink } from "./fuzz/generate.js";
import type { GenerateOptions } from "./fuzz/generate.js";
import { attempt, difference } from "./fuzz/snapshot.js";
import { readToken, specCheckError } from "./helpers.js";

vi.setConfig({ testTimeout: TIMEOUT });

const shapes: GenerateOptions = { persistentSubcommands: true, hiddenSubcommands: true };

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

/**
 * Why `path` isn't one the parser can follow on `input`, or null. Each command
 * after the spec is a subcommand of the one before it, or a persistent
 * subcommand of a command further up. A persistent subcommand entered from
 * below its parent, or a hidden one, only matches its exact name, so one of
 * its names is an input token.
 */
function invalidPath(
  path: readonly (Spec | Subcommand)[],
  spec: Spec,
  input: readonly string[],
): string | null {
  if (path[0] !== spec) {
    return "path doesn't start at the spec";
  }
  for (let i = 1; i < path.length; i++) {
    const command = path[i] as Subcommand;
    const own = path[i - 1].subcommands?.includes(command) ?? false;
    if (!own) {
      if (!command.isPersistent) {
        return `path[${i}] isn't a subcommand of path[${i - 1}], and isn't persistent`;
      }
      if (!path.slice(0, i - 1).some((above) => above.subcommands?.includes(command))) {
        return `path[${i}] isn't a subcommand of any command before it on the path`;
      }
    }
    if ((!own || command.hidden) && !asArray(command.name).some((name) => input.includes(name))) {
      return `path[${i}] matched without its exact name`;
    }
  }
  return null;
}

/** The names of every option the lenient read uses, token by token. */
async function usedNames(spec: Spec, input: readonly string[]): Promise<Set<string>> {
  const names = new Set<string>();
  const reader = tokenReader(spec);
  for (const word of input) {
    const token = await reader.read(word);
    if (token.kind !== "options") {
      continue;
    }
    for (const { option } of token.uses) {
      for (const name of asArray(option?.name)) {
        names.add(name);
      }
    }
  }
  return names;
}

/** The first property that `readNext` or `parse` breaks for this spec and input, or null. */
async function violation(spec: Spec, input: string[]): Promise<string | null> {
  let next: NextToken;
  try {
    next = await readNext(spec, input, "");
  } catch (error) {
    return `readNext threw ${String(error)}`;
  }

  const path = next.line.path as readonly (Spec | Subcommand)[];
  const badPath = invalidPath(path, spec, input);
  if (badPath) {
    return badPath;
  }

  const directives = JSON.stringify(next.directives);
  const expected = JSON.stringify(expectedDirectives(path));
  if (directives !== expected) {
    return `directives are ${directives}, expected ${expected}`;
  }

  const strict = await attempt(parse, input, spec);
  if (strict.ok) {
    const result = strict.result;
    // Every argument is a whole input token, in order.
    let from = 0;
    for (const arg of result.args) {
      const at = input.indexOf(arg as string, from);
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
    const seenNames = [...(await usedNames(spec, input))].sort();
    const parsedNames = [...result.options.options.keys()].sort();
    if (JSON.stringify(seenNames) !== JSON.stringify(parsedNames)) {
      return `readNext saw options named ${JSON.stringify(seenNames)}, but parse has ${JSON.stringify(parsedNames)}`;
    }
    return null;
  }

  const error = strict.error;
  if (!(error instanceof ParseError)) {
    return `parse threw ${error.name}: ${error.message}`;
  }
  const errorPath = invalidPath(error.context.path as readonly (Spec | Subcommand)[], spec, input);
  if (errorPath) {
    return `error ${errorPath}`;
  }
  return null;
}

test("readNext and parse keep their invariants on random specs", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), shapes);
    const spec = gen.spec();
    const input = gen.input(spec);
    if ((await violation(spec, input)) === null) {
      continue;
    }
    const small = await shrink(spec, input, async (s, i) => (await violation(s, i)) !== null);
    expect.fail(report(n, small.spec, small.input, (await violation(small.spec, small.input)) ?? ""));
  }
});

/** Parse `input` with a token reader, one token at a time. */
async function readAndFinish(input: readonly string[], spec: Spec) {
  const reader = tokenReader(spec);
  for (const token of input) {
    await reader.read(token);
  }
  return reader.finish();
}

/** Where a problem is, from the outcome of a parse that threw. */
function where(outcome: Awaited<ReturnType<typeof attempt>>): string {
  if (outcome.ok) {
    return "";
  }
  const { problems, context } = outcome.error as unknown as ParseError;
  return JSON.stringify((problems ?? [{ context }]).map((p) => [p.context.token, p.context.start]));
}

test("a token reader finishes the line the way parse does", async () => {
  const property = async (spec: Spec, input: string[]) => {
    const parsed = await attempt(parse, input, spec);
    const read = await attempt(readAndFinish, input, spec);
    return (
      difference(parsed, read) ?? (where(parsed) === where(read) ? null : "problems are in other tokens")
    );
  };
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), shapes);
    const spec = gen.spec();
    const input = gen.input(spec);
    if ((await property(spec, input)) === null) {
      continue;
    }
    const small = await shrink(spec, input, async (s, i) => (await property(s, i)) !== null);
    expect.fail(report(n, small.spec, small.input, (await property(small.spec, small.input)) ?? ""));
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
 * after the typed ones, and values of the options that were used. And `get`
 * and `all` only give defaults for options that weren't used and whose first
 * argument is required.
 */
async function defaultsViolation(spec: Spec, input: string[]): Promise<string | null> {
  const plain = await attempt(parse, input, withoutDefaults(spec));
  const withDefaults = await attempt(parse, input, spec);
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
  const values = result.options.options;
  const keys = (map: Map<string, unknown[]>) => JSON.stringify([...map.keys()]);
  if (keys(typed.options.options) !== keys(values)) {
    return "defaults change which options were used";
  }
  for (const [name, typedValues] of typed.options.options) {
    const extra = addedValues(typedValues, values.get(name)!);
    if (!extra) {
      return `the values of ${name} don't keep the typed ones in order`;
    }
    const owners = optionsNamed(spec, name);
    const allowed = new Set<unknown>(
      owners.flatMap((option) => asArray(option.args).map((arg) => arg.default)),
    );
    const wrong = extra.find((value) => !allowed.has(value));
    if (wrong !== undefined) {
      return `${name} has the value ${JSON.stringify(wrong)}, which isn't typed or a default`;
    }
    // With one option of that name, used once, the values are exactly the
    // typed ones and the defaults of the arguments after them.
    const [only] = owners;
    if (owners.length === 1 && !only.isRepeatable) {
      const expected = [...typedValues, ...leadingDefaults(only.args, typedValues.length)];
      const got = values.get(name)!;
      if (JSON.stringify(got) !== JSON.stringify(expected)) {
        return `${name} is ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`;
      }
    }
  }

  const path = result.path as readonly (Spec | Subcommand)[];
  const command = path[path.length - 1];
  const fills = !command.requiresSubcommand && typed.args.length >= minArgs(command.args);
  const expected = [...typed.args, ...(fills ? leadingDefaults(command.args, typed.args.length) : [])];
  if (JSON.stringify(result.args) !== JSON.stringify(expected)) {
    return `args are ${JSON.stringify(result.args)}, expected ${JSON.stringify(expected)}`;
  }

  // Each answer about an option agrees with the values stored for it. An
  // unused option gives its defaults to `get` and `all`.
  const options = result.options;
  for (const name of OPTION_NAMES) {
    const stored = values.get(name);
    const option = stored ? undefined : optionNamed(path, name);
    const first = asArray(option?.args)[0];
    const defaults = first && !first.isOptional ? leadingDefaults(option!.args, 0) : [];
    const all = stored ?? defaults;
    // A use without values counts once.
    const count = stored === undefined ? 0 : Math.max(stored.length, 1);
    const want = JSON.stringify([stored !== undefined, all[0], all, count]);
    const got = JSON.stringify([
      options.has(name),
      options.get(name),
      options.all(name),
      options.count(name),
    ]);
    if (got !== want) {
      return `has, get, all and count of ${JSON.stringify(name)} are ${got}, expected ${want}`;
    }
  }
  return null;
}

/**
 * The values in `values` that aren't the typed ones, if `typed` is a
 * subsequence of it. Otherwise null.
 */
function addedValues(typed: readonly unknown[], values: readonly unknown[]): unknown[] | null {
  const extra: unknown[] = [];
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

test("defaults only add to what the user typed", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), { ...shapes, defaults: true });
    const spec = gen.spec();
    const input = gen.input(spec);
    if ((await defaultsViolation(spec, input)) === null) {
      continue;
    }
    const small = await shrink(spec, input, async (s, i) => (await defaultsViolation(s, i)) !== null);
    expect.fail(report(n, small.spec, small.input, (await defaultsViolation(small.spec, small.input)) ?? ""));
  }
});

test("completion never throws on random specs", async () => {
  // Completion is slower and async, so it gets a tenth of the cases.
  for (const n of caseNumbers(10)) {
    const gen = generator(caseSeed(n), shapes);
    const spec = gen.spec();
    const before = gen.input(spec);
    const partial = gen.input(spec)[0] ?? "";
    try {
      await complete(spec, before, partial, { optionsNeedDash: gen.random.chance(0.5) });
    } catch (error) {
      expect.fail(report(n, spec, [...before, partial], `completion threw: ${String(error)}`));
    }
  }
});

const specChecks = [
  "assertNamesReadBack",
  "assertOptionsHaveLocallyUniqueNames",
  "assertSubcommandsHaveLocallyUniqueNames",
];

/** An option or subcommand that completion offers, but that the parser reads as something else. */
async function offeredButMisread(spec: Spec, before: string[]): Promise<string | null> {
  // The parser can't read every option of a spec that the spec checker rejects.
  if ((await specCheckError(specChecks, spec)) !== undefined) {
    return null;
  }
  const offered = new Set((await complete(spec, before, "")).flatMap((c) => asArray(c.name)));
  const next = await readNext(spec, before, "");
  for (const { command, names } of next.subcommands()) {
    for (const name of names) {
      if (!offered.has(name)) {
        continue;
      }
      const reading = await readToken(spec, before, name);
      if (reading.kind !== "subcommand" || reading.command !== command) {
        return `subcommand ${JSON.stringify(name)} is offered, but isn't read as that subcommand`;
      }
    }
  }
  for (const { option, forms } of next.options()) {
    for (const form of forms) {
      const token = formStart(form);
      if (!offered.has(token)) {
        continue;
      }
      const read = await readToken(spec, before, token);
      if (read.kind !== "options" || read.uses.length !== 1 || read.uses[0].option !== option) {
        return `option ${JSON.stringify(token)} is offered, but isn't read as that option`;
      }
    }
  }
  return null;
}

/** A subcommand the parser enters by one of its names, where readNext doesn't list it by that name. */
async function enteredButNotListed(spec: Spec, input: readonly string[]): Promise<string | null> {
  for (let i = 0; i < input.length; i++) {
    const before = input.slice(0, i);
    const token = input[i];
    const reading = await readToken(spec, before, token);
    if (reading.kind !== "subcommand" || !asArray(reading.command.name).includes(token)) {
      continue;
    }
    const listed = (await readNext(spec, before, ""))
      .subcommands()
      .some(({ command, names }) => command === reading.command && names.includes(token));
    if (!listed) {
      return `token ${i}, ${JSON.stringify(token)}, enters a subcommand that readNext doesn't list by that name`;
    }
  }
  return null;
}

test("readNext lists every subcommand the parser enters by name", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), shapes);
    const spec = gen.spec();
    const input = gen.input(spec);
    const violation = await enteredButNotListed(spec, input);
    if (violation !== null) {
      expect.fail(report(n, spec, input, violation));
    }
  }
});

test("completion only offers options and subcommands the parser reads as such", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), shapes);
    const spec = gen.spec();
    const input = gen.input(spec);
    if ((await offeredButMisread(spec, input)) === null) {
      continue;
    }
    expect.fail(report(n, spec, input, (await offeredButMisread(spec, input)) ?? ""));
  }
});
