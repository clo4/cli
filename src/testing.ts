/**
 * Supplementary module to make testing your CLI easier.
 *
 * @module
 */

import type { Arg, Option, SingleOrArray, Spec, Subcommand } from "./types.js";
import { assert, getMaxArgs, getMinArgs, makeArray } from "./util.js";
import { CommandScope, optionKey } from "./scope.js";
import type { OptionForm } from "./scope.js";
import { optionToString } from "./help.js";
import { readToken, tokenReader } from "./parse.js";
import type { TokenReading } from "./parse.js";

const repr = JSON.stringify;

// TODO: one decorators are stable (ts 4.9?), use decorators this file

/** An option, the path to the command that defines it, and its index there. */
interface Definition {
  option: Option;
  definedIn: Subcommand[];
  index: number;
}

/** One command in the spec, with what's in effect there. */
class CommandVisit {
  private built: CommandScope | null = null;

  constructor(
    /** The commands from the root to this one. */
    readonly path: Subcommand[],
    /** This command's options, in definition order. */
    readonly own: Definition[],
    /** The persistent options of the commands above, root first. */
    readonly inherited: Definition[],
  ) {}

  /** The last command on the path. */
  get command(): Subcommand {
    return this.path[this.path.length - 1];
  }

  /** The options, subcommands and directives in effect here, built on first use. */
  get scope(): CommandScope {
    return (this.built ??= CommandScope.at(this.path));
  }
}

/**
 * Run a function once for each command in the spec, parents before their
 * subcommands, starting with `spec`. Each visit's path and scope start at
 * `spec`.
 */
function forEachCommand(spec: Subcommand, fn: (visit: CommandVisit) => void): void {
  const visit = (path: Subcommand[], inherited: Definition[]) => {
    const command = path[path.length - 1];
    const own = makeArray(command.options).map((option, index) => ({ option, definedIn: path, index }));
    fn(new CommandVisit(path, own, inherited));
    const next = [...inherited, ...own.filter(({ option }) => option.isPersistent)];
    for (const subcommand of makeArray(command.subcommands)) {
      visit([...path, subcommand], next);
    }
  };
  visit([spec], []);
}

/**
 * Run a function once for each `args` property in the spec: each command's,
 * then its options'. This will convert single args to an array with one item.
 */
function forEachArgArray(spec: Subcommand, fn: (args: Arg[], path: Subcommand[]) => void): void {
  forEachCommand(spec, ({ command, path }) => {
    fn(makeArray(command.args), path);
    for (const option of makeArray(command.options)) {
      fn(makeArray(option.args), path);
    }
  });
}

function joinNames(names: SingleOrArray<string>) {
  return makeArray(names)
    .sort((a, b) => a.length - b.length)
    .join("|");
}

/** Compares spec values by shape. Any two functions count as the same shape. */
function isSameStructure(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === "function" && typeof b === "function") {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => isSameStructure(left[key], right[key]));
}

function namedArrayToString(...parts: { name: SingleOrArray<string> }[]) {
  const names = parts.map((named) => joinNames(named.name));
  return `\`${names.join(" ")}\``;
}

/** Name the last command on `path` in a message, with its index among its siblings. */
function describeCommand(path: readonly Subcommand[]): string {
  const command = path[path.length - 1];
  const parent = path[path.length - 2];
  if (!parent) {
    return `Command ${namedArrayToString(command)}`;
  }
  const index = makeArray(parent.subcommands).indexOf(command);
  return `Subcommand ${namedArrayToString(...path)} (index ${index})`;
}

/**
 * Name the option at `index` on the last command on `definedIn` in a message,
 * and the command it's used in when that isn't the one that defines it.
 */
function describeOption(definedIn: readonly Subcommand[], index: number, usedIn = definedIn): string {
  const option = makeArray(definedIn[definedIn.length - 1].options)[index];
  const name = `${namedArrayToString(...definedIn, option)} (index ${index})`;
  return usedIn === definedIn ? `Option ${name}` : `In ${namedArrayToString(...usedIn)}, option ${name}`;
}

/** One option, at one command it can be used in. */
interface OptionUse {
  option: Option;
  /** The commands from the root to the one the option is used in. */
  path: Subcommand[];
  /** The options and directives in effect there. */
  scope: CommandScope;
  /** Whether the command it's used in is the one that defines it. */
  isDefinedHere: boolean;
  /** Names the option at the start of a message. See {@link describeOption}. */
  where: string;
}

/**
 * Run a function once for each option at each command it can be used in: the
 * command's own options, in definition order, then the persistent ones it
 * inherits. A check that is about how the option is written skips the uses
 * that aren't `isDefinedHere`. A check that depends on the scope sees the
 * option the way the parser does at each command.
 */
function forEachOption(spec: Subcommand, fn: (use: OptionUse) => void): void {
  forEachCommand(spec, ({ path, own, inherited, scope }) => {
    for (const { option, definedIn, index } of [...own, ...inherited]) {
      const where = describeOption(definedIn, index, path);
      fn({ option, path, scope, isDefinedHere: definedIn === path, where });
    }
  });
}

/** Asserts that required arguments do not come after an optional argument */
export function assertRequiredArgumentsDoNotFollowOptionalArguments(spec: Subcommand): void {
  forEachArgArray(spec, (args, path) => {
    let remainingMustBeOptional = false;
    let firstOptionalArgIndex: number | null = null;
    for (const [index, arg] of args.entries()) {
      if (remainingMustBeOptional) {
        assert(
          arg.isOptional,
          `In ${namedArrayToString(...path)}, argument ${arg.name || index} is required, but it must be optional since the argument at index ${firstOptionalArgIndex} is optional`,
        );
      } else if (arg.isOptional) {
        remainingMustBeOptional = true;
        firstOptionalArgIndex ??= index;
      }
    }
  });
}

/**
 * Asserts that the parser can use every default. A positional argument with a
 * default must be optional. A required option argument's default is only used
 * when the option is left out, so every argument before it needs a default
 * too, and the option can't be required.
 */
export function assertDefaultsCanBeUsed(spec: Subcommand): void {
  forEachCommand(spec, ({ command, path }) => {
    for (const [index, arg] of makeArray(command.args).entries()) {
      assert(
        arg.default === undefined || arg.isOptional,
        `In ${namedArrayToString(...path)}, argument ${arg.name || index} has a default, but it's required, so the default is never used`,
      );
    }
  });
  forEachOption(spec, ({ option, isDefinedHere, where }) => {
    if (!isDefinedHere) {
      return;
    }
    let firstWithout: number | null = null;
    for (const [index, arg] of makeArray(option.args).entries()) {
      if (arg.default === undefined) {
        firstWithout ??= index;
        continue;
      }
      if (arg.isOptional) {
        continue;
      }
      const name = `${where}, argument ${arg.name || index} has a default, but`;
      assert(!option.isRequired, `${name} the option is required, so the default is never used`);
      assert(
        firstWithout === null,
        `${name} the argument at index ${firstWithout} has none, so the default is never used`,
      );
    }
  });
}

/** Asserts that `isRepeatable` is only assigned a positive integer */
export function assertRepeatableOptionsArePositiveIntegers(spec: Subcommand): void {
  forEachOption(spec, ({ option, isDefinedHere, where }) => {
    if (!isDefinedHere || typeof option.isRepeatable !== "number") {
      return;
    }
    assert(
      Number.isSafeInteger(option.isRepeatable),
      `${where} has its \`isRepeatable\` value set to a number that is not an integer`,
    );
    assert(
      !(option.isRepeatable < 1),
      `${where} has its \`isRepeatable\` value set to a number below 1, which means it can't be used at all`,
    );
    assert(
      option.isRepeatable !== 1,
      `${where} has its \`isRepeatable\` value set to 1, which is no different that omitting the property entirely`,
    );
  });
}

/** Asserts that options have unique names in their scope */
export function assertOptionsHaveLocallyUniqueNames(spec: Subcommand): void {
  forEachCommand(spec, ({ path, own }) => {
    const optionNames = new Set<string>();
    for (const { option, index } of own) {
      for (const name of makeArray(option.name)) {
        assert(
          !optionNames.has(name),
          `${describeOption(path, index)} has a non-unique name, '${name}'. Option names must be unique.`,
        );
        optionNames.add(name);
      }
    }
  });
}

/** Asserts that options don't shadow a persistent option */
export function assertOptionsDoNotShadowPersistentOptions(spec: Subcommand): void {
  forEachCommand(spec, ({ path, own, inherited }) => {
    for (const { option, index } of own) {
      for (const name of makeArray(option.name)) {
        assert(
          !inherited.some((persistent) => makeArray(persistent.option.name).includes(name)),
          `${describeOption(path, index)} shadows the name of a persistent option, ${repr(name)}. Option names can't shadow persistent options.`,
        );
      }
    }
  });
}

/**
 * Asserts that when a subcommand's option and a different option on a parent
 * share a name, each of them has a name of its own.
 *
 * Parsed values are looked up by name, and an option sets every one of its
 * names when it's used. If every name of the parent's option is also the
 * subcommand's, using the subcommand's option replaces the parent's value, so
 * it can't be read. If every name of the subcommand's option is also the
 * parent's, its names hold the parent's value when it isn't used, so it can't
 * tell whether it was. Options with the same names are fine when they're
 * identical, such as an option kept in a constant, because the parser treats
 * them as one option.
 *
 * This skips persistent parent options, because
 * {@link assertOptionsDoNotShadowPersistentOptions} covers those and
 * `allowShadowingPersistentOptions` opts out of it.
 */
export function assertOptionsHaveDifferentNamesFromParents(spec: Subcommand): void {
  forEachOption(spec, ({ option, path, isDefinedHere, where }) => {
    if (!isDefinedHere) {
      return;
    }
    const names = makeArray(option.name);
    // A parent's non-persistent options aren't in this command's scope, so
    // they're found on the parents themselves.
    for (const parent of path.slice(0, -1)) {
      for (const parentOption of makeArray(parent.options)) {
        if (parentOption.isPersistent) {
          continue;
        }
        const parentNames = makeArray(parentOption.name);
        const other = namedArrayToString(parent, parentOption);
        if (optionKey(parentOption) === optionKey(option)) {
          assert(
            isSameStructure({ ...parentOption, name: 0 }, { ...option, name: 0 }),
            `${where} has the same names as a different option, ${other}, so the parent's value can't be read. Add a name that only one of them uses.`,
          );
          continue;
        }
        assert(
          !parentNames.every((name) => names.includes(name)),
          `${where} has every name of a different option, ${other}, so the parent's value can't be read. Add a name that only the parent's option uses.`,
        );
        assert(
          !names.every((name) => parentNames.includes(name)),
          `${where} only has names of a different option, ${other}, so it can't tell whether it was used. Add a name that only the subcommand's option uses.`,
        );
      }
    }
  });
}

/** Asserts that subcommands don't share a name with a sibling subcommand */
export function assertSubcommandsHaveLocallyUniqueNames(spec: Subcommand): void {
  forEachCommand(spec, ({ command, path }) => {
    const names = new Set<string>();
    for (const [index, subcommand] of makeArray(command.subcommands).entries()) {
      for (const name of makeArray(subcommand.name)) {
        assert(
          !names.has(name),
          `The subcommand ${namedArrayToString(...path, subcommand)} (index ${index}) has a non-unique name, ${repr(name)}. Subcommand names must be unique among the subcommands in the same array.`,
        );
        names.add(name);
      }
    }
  });
}

/**
 * Asserts that no option arg separator is an empty string
 */
export function assertOptionArgSeparatorsHaveCharacters(spec: Subcommand): void {
  forEachCommand(spec, ({ command, path }) => {
    const separators = makeArray(command.parserDirectives?.optionArgSeparators);
    for (const [sepIndex, separator] of separators.entries()) {
      assert(
        separator !== "",
        `${describeCommand(path)} has an empty string for an option arg separator at index ${sepIndex}. If you wanted to disable option arg separators, use an empty array.`,
      );
    }
  });
}

/**
 * Asserts that the parser reads options named "+" or "-" the way they're
 * written, which needs them to take one argument.
 *
 * @deprecated {@link assertNamesReadBack} checks this for every option.
 */
export function assertPlusMinusOptionsTakeOneArg(spec: Subcommand): void {
  assertOptionFormsReadBack(spec, (_, name) => name === "-" || name === "+");
}

/**
 * Asserts that names do not have leading or trailing whitespace
 */
export function assertNamesHaveNoExtraWhitespace(spec: Subcommand): void {
  forEachOption(spec, ({ option, isDefinedHere, where }) => {
    if (!isDefinedHere) {
      return;
    }
    for (const name of makeArray(option.name)) {
      assert(name === name.trim(), `${where} has a name with extra whitespace`);
    }
  });
  forEachCommand(spec, ({ command, path }) => {
    for (const name of makeArray(command.name)) {
      assert(name === name.trim(), `${describeCommand(path)} has a name with extra whitespace`);
    }
  });
  forEachArgArray(spec, (args, path) => {
    for (const [index, arg] of makeArray(args).entries()) {
      for (const name of makeArray(arg.name)) {
        assert(
          name === name.trim(),
          `Arg in ${namedArrayToString(...path)} (at index ${index}) has a name with extra whitespace`,
        );
      }
    }
  });
}

/**
 * Asserts that everything has a description
 */
export function assertEverythingHasDescription(spec: Subcommand): void {
  assert(spec.description, `Spec has no description`);
  forEachOption(spec, ({ option, isDefinedHere, where }) => {
    if (isDefinedHere) {
      assert(option.description, `${where} has no description`);
    }
  });
  forEachCommand(spec, ({ command, path }) => {
    assert(command.description, `${describeCommand(path)} has no description`);
  });
}

/**
 * Asserts that descriptions have line length < 69
 */
export function assertDescriptionLineLengthUnder69(spec: Subcommand): void {
  if (spec.description) {
    assert(
      spec.description.split("\n").every((line) => line.length <= 68),
      `Spec has a description line over 68 characters`,
    );
  }
  forEachOption(spec, ({ option, isDefinedHere, where }) => {
    if (!isDefinedHere || !option.description) {
      return;
    }
    assert(
      option.description.split("\n").every((line) => line.length <= 68),
      `${where} has a description line over 68 characters`,
    );
  });
  forEachCommand(spec, ({ command, path }) => {
    if (command.description) {
      assert(
        command.description.split("\n").every((line) => line.length <= 68),
        `${describeCommand(path)} has a description line over 68 characters`,
      );
    }
    // Help lists positional arguments with their descriptions.
    for (const [index, arg] of makeArray(command.args).entries()) {
      assert(
        !arg.description || arg.description.split("\n").every((line) => line.length <= 68),
        `In ${namedArrayToString(...path)}, argument ${arg.name || index} has a description line over 68 characters`,
      );
    }
  });
}

/**
 * Asserts that the parser reads options with `requiresSeparator` the way
 * they're written, which needs them to take at most one argument.
 *
 * @deprecated {@link assertNamesReadBack} checks this for every option.
 */
export function assertRequiresSeparatorTakesOneArg(spec: Subcommand): void {
  assertOptionFormsReadBack(spec, (option) => Boolean(option.requiresSeparator));
}

/**
 * What the parser read a token as, for a message. `path` is the command the
 * token came after.
 */
function describeReading(reading: TokenReading, path: readonly Subcommand[]): string {
  switch (reading.kind) {
    case "separator":
      return "the end of options, '--'";
    case "subcommand":
      return `the subcommand ${namedArrayToString(...path, reading.command)}`;
    case "options":
      return reading.options.length === 1
        ? `the option ${namedArrayToString(reading.options[0])}`
        : `the options ${reading.options.map((option) => namedArrayToString(option)).join(", ")}`;
    case "value":
      return `a value of the option ${namedArrayToString(reading.option)}`;
    case "argument":
      return "an argument";
    case "unknown":
      return "an option that doesn't exist";
  }
}

/** Whether the parser read a token as `option` alone. */
function readsAs(reading: TokenReading, option: Option): boolean {
  return reading.kind === "options" && reading.options.length === 1 && reading.options[0] === option;
}

/**
 * The tokens that reach the last command on `path`, using each command's first
 * name. {@link assertNamesReadBack} checks subcommand names from the root down
 * before options, so each of these is a name the parser reads.
 */
function tokensTo(path: readonly Subcommand[]): string[] {
  return path.slice(1).map((command) => makeArray(command.name)[0]);
}

/**
 * A value for writing options with at the last command on `path`. No name
 * there starts with it, or with it after '-' or '+', so the parser can only
 * read it as a value.
 */
function placeholderValue(path: readonly Subcommand[], scope: CommandScope): string {
  const names = [
    ...[...scope.local, ...scope.persistent].flatMap((option) => makeArray(option.name)),
    ...makeArray(path[path.length - 1].subcommands).flatMap((command) => makeArray(command.name)),
  ];
  for (const value of "0123456789abcdefghijklmnopqrstuvwxyz") {
    const starts = [value, `-${value}`, `+${value}`];
    if (!names.some((name) => starts.some((start) => name.startsWith(start)))) {
      return value;
    }
  }
  return "0";
}

/**
 * The tokens that write `form` with every value `option` takes, or one more
 * than its minimum if it takes any number. The first value is joined to the
 * name if the form says so, and the rest are separate tokens.
 */
function writeForm(option: Option, form: OptionForm, value: string): string[] {
  const max = getMaxArgs(option.args);
  const count = Number.isFinite(max) ? max : getMinArgs(option.args) + 1;
  const values: string[] = Array.from({ length: count }, () => value);
  if (form.join === null) {
    return [form.name, ...values];
  }
  return [form.name + form.join + values[0], ...values.slice(1)];
}

/**
 * Asserts that the parser reads each name of the options that `include`
 * picks the way the name is written. See {@link assertNamesReadBack}.
 */
function assertOptionFormsReadBack(spec: Subcommand, include: (option: Option, name: string) => boolean) {
  const root = spec as Spec;
  forEachOption(spec, ({ option, where, scope, path }) => {
    const before = tokensTo(path);
    const value = placeholderValue(path, scope);
    // A name that another option shadows is that option's to check.
    const names = makeArray(option.name).filter((name) => scope.resolve(name) === option);
    for (const form of scope.forms(option, names)) {
      if (!include(option, form.name)) {
        continue;
      }
      // A name joined to its value with nothing between isn't a token by itself.
      if (form.join !== "") {
        const reading = readToken(root, before, form.name);
        assert(
          readsAs(reading, option),
          `${where} has the name '${form.name}', but the parser reads it as ${describeReading(reading, path)}`,
        );
      }
      const tokens = writeForm(option, form, value);
      const written = `${where} is written '${optionToString(option, [form])}'`;
      if (form.join) {
        assert(
          scope.readsSeparator(form.join),
          `${written}, but '${form.join}' isn't one of the option arg separators there (${scope.directives.optionArgSeparators.map((separator) => `'${separator}'`).join(", ") || "none"}). Add it to \`parserDirectives.optionArgSeparators\`.`,
        );
      }
      const reader = tokenReader(root);
      for (const token of before) {
        reader.read(token);
      }
      const first = reader.read(tokens[0]);
      if (form.join !== null) {
        const joined = first.kind === "options" && first.attached?.option === option;
        assert(
          readsAs(first, option) && joined,
          `${written}, but the parser reads '${tokens[0]}' as ${describeReading(first, path)}${joined ? "" : " without a value"}`,
        );
      }
      for (let index = 1; index < tokens.length; index++) {
        const reading = reader.read(tokens[index]);
        assert(
          reading.kind === "value" && reading.option === option,
          `${written}, but in '${tokens.join(" ")}' the parser reads '${tokens[index]}' as ${describeReading(reading, path)}`,
        );
      }
    }
  });
}

/**
 * Asserts that the parser reads every name the way it's written: each name of
 * a subcommand enters that subcommand, and each name of an option uses that
 * option, at every command the option can be used in. Each option is also
 * written the way help shows it, with every value it takes, and the parser has
 * to read all of those values as the option's.
 */
export function assertNamesReadBack(spec: Subcommand): void {
  const root = spec as Spec;
  forEachCommand(spec, ({ command, path }) => {
    const before = tokensTo(path);
    for (const subcommand of makeArray(command.subcommands)) {
      for (const name of makeArray(subcommand.name)) {
        const reading = readToken(root, before, name);
        if (reading.kind === "subcommand" && reading.command === subcommand) {
          continue;
        }
        assert(
          false,
          `${describeCommand([...path, subcommand])} has the name '${name}', but the parser reads it as ${describeReading(reading, path)}`,
        );
      }
    }
  });
  assertOptionFormsReadBack(spec, () => true);
}

export function assertCommonOptionsArePersistent(spec: Subcommand): void {
  const failures: [string, string][] = [];
  forEachCommand(spec, ({ command, path }) => {
    if (!command.subcommands) {
      return;
    }
    // This command's options that every command below it defines too.
    let common = makeArray(command.options);
    forEachCommand(command, ({ command: below }) => {
      const keys = makeArray(below.options).map(optionKey);
      common = common.filter((option) => keys.includes(optionKey(option)));
    });
    for (const option of common) {
      const key = optionKey(option);
      if (!failures.some(([failed]) => failed === key)) {
        failures.push([key, namedArrayToString(...path, option)]);
      }
    }
  });
  assert(
    failures.length === 0,
    `The following options were also defined by all subcommands. Instead, define the option once, and use \`isPersistent: true\` to persist it across all subcommands.
${failures.map(([, line]) => " * " + line).join("\n")}
`,
  );
}

/**
 * Asserts that references to other options by name actually refer to options
 * that exist in scope, at every command the option can be used in
 */
export function assertOptionNameReferencesExist(spec: Subcommand): void {
  forEachOption(spec, ({ option, where, scope }) => {
    for (const name of makeArray(option.dependsOn)) {
      assert(
        scope.resolve(name) !== null,
        `${where} depends on an option named ${repr(name)}, which doesn't exist in its scope`,
      );
    }
    for (const name of makeArray(option.exclusiveOn)) {
      assert(
        scope.resolve(name) !== null,
        `${where} is exclusive on an option named ${repr(name)}, which doesn't exist in its scope`,
      );
    }
  });
}

/**
 * Asserts that commands that will match subcommands by prefix do not take arguments
 */
export function assertPrefixMatchCommandsHaveNoArguments(spec: Subcommand): void {
  forEachCommand(spec, ({ command, path, scope }) => {
    // The scope is at this command, so this is the setting that decides how
    // its own subcommands are matched.
    if (!scope.directives.subcommandsMatchUniquePrefix) {
      return;
    }

    assert(
      !(command.subcommands && command.args),
      `The command ${namedArrayToString(
        ...path,
      )} has at least one argument and subcommand, but matches subcommands based on unique prefixes. To fix this, use \`parserDirectives: { subcommandsMatchUniquePrefix: false }\``,
    );
  });
}

export type TestNamingStyle = "sentence" | "function";

/** Options that can be provided to `test` */
export interface TestOptions {
  /**
   * Allows options to shadow persistent options.
   *
   * This behavior may be desirable if you want to override an option on a
   * particular subcommand, but not for others.
   *
   * Be aware that this is not idiomatic.
   */
  allowShadowingPersistentOptions?: boolean;

  /**
   * Allows subcommands and options to not have a description
   */
  allowNoDescription?: boolean;

  /**
   * Allows descriptions to have lines over 68 characters long
   */
  allowLongDescriptionLines?: boolean;

  /**
   * Allow commands to have `parserDirectives.subcommandsMatchUniquePrefix` with args
   *
   * This is not allowed by default because it's probably a mistake. It makes
   * arguments ambiguous, users may not know if their invocation will run a
   * subcommand or the command.
   */
  allowMatchingSubcommandPrefixAndArgs?: boolean;

  /**
   * Change the naming style of the tests.
   *
   * - `sentence`: Use proper sentence casing, punctuation, etc
   * - `function`: Use the name of the assert function that will be executed
   */
  namingStyle?: TestNamingStyle;
}

export interface TestContextLike {
  step(name: string, fn: () => unknown | Promise<unknown>): unknown | Promise<unknown>;
}

async function runStep(
  context: TestContextLike | undefined,
  name: string,
  fn: () => unknown | Promise<unknown>,
): Promise<void> {
  if (context) {
    await context.step(name, fn);
    return;
  }
  await fn();
}

/**
 * Validate your CLI in your test suite
 *
 * This enforces certain constraints that the type system cannot. The parser
 * may ignore these issues, producing correct output that _appears_ to be
 * wrong.
 */
export function test(spec: Subcommand, options: TestOptions = {}): (t?: TestContextLike) => Promise<void> {
  const {
    allowShadowingPersistentOptions = false,
    allowNoDescription = false,
    allowLongDescriptionLines = false,
    allowMatchingSubcommandPrefixAndArgs = false,
    namingStyle = "sentence",
  } = options;
  const checks: [
    sentence: string,
    functionName: string,
    check: (spec: Subcommand) => void,
    enabled: boolean,
  ][] = [
    [
      "Required arguments don't follow optional arguments",
      "assertRequiredArgumentsDoNotFollowOptionalArguments",
      assertRequiredArgumentsDoNotFollowOptionalArguments,
      true,
    ],
    ["The parser can use every default", "assertDefaultsCanBeUsed", assertDefaultsCanBeUsed, true],
    [
      "Repeatable options that are numbers are integers greater than 1",
      "assertRepeatableOptionsArePositiveIntegers",
      assertRepeatableOptionsArePositiveIntegers,
      true,
    ],
    [
      "Options have locally unique names",
      "assertOptionsHaveLocallyUniqueNames",
      assertOptionsHaveLocallyUniqueNames,
      true,
    ],
    [
      "Options don't shadow persistent options",
      "assertOptionsDoNotShadowPersistentOptions",
      assertOptionsDoNotShadowPersistentOptions,
      !allowShadowingPersistentOptions,
    ],
    [
      "Different options on a subcommand and its parents have different names",
      "assertOptionsHaveDifferentNamesFromParents",
      assertOptionsHaveDifferentNamesFromParents,
      true,
    ],
    [
      "Subcommands have locally unique names",
      "assertSubcommandsHaveLocallyUniqueNames",
      assertSubcommandsHaveLocallyUniqueNames,
      true,
    ],
    [
      "The parser reads every option and subcommand the way it's written",
      "assertNamesReadBack",
      assertNamesReadBack,
      true,
    ],
    [
      "Option arg separators are not an empty string",
      "assertOptionArgSeparatorsHaveCharacters",
      assertOptionArgSeparatorsHaveCharacters,
      true,
    ],
    [
      "Names have no extra leading or trailing whitespace",
      "assertNamesHaveNoExtraWhitespace",
      assertNamesHaveNoExtraWhitespace,
      true,
    ],
    [
      "Everything has a description",
      "assertEverythingHasDescription",
      assertEverythingHasDescription,
      !allowNoDescription,
    ],
    [
      "Each line in descriptions is less than or equal to 68 characters",
      "assertDescriptionLineLengthUnder69",
      assertDescriptionLineLengthUnder69,
      !allowLongDescriptionLines,
    ],
    [
      "Common options are not defined on every subcommand",
      "assertCommonOptionsArePersistent",
      assertCommonOptionsArePersistent,
      true,
    ],
    [
      "References to other options by name are valid",
      "assertOptionNameReferencesExist",
      assertOptionNameReferencesExist,
      true,
    ],
    [
      "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
      "assertPrefixMatchCommandsHaveNoArguments",
      assertPrefixMatchCommandsHaveNoArguments,
      !allowMatchingSubcommandPrefixAndArgs,
    ],
  ];
  return async (t) => {
    for (const [sentence, functionName, check, enabled] of checks) {
      if (!enabled) {
        continue;
      }
      await runStep(t, namingStyle === "function" ? functionName : sentence, () => check(spec));
    }
  };
}

export const testSpec = test;
