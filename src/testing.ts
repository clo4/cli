/**
 * Supplementary module to make testing your CLI easier.
 *
 * @module
 */

import type { Arg, Option, SingleOrArray, Subcommand } from "./types.js";
import { assert, getMaxArgs, getMinArgs, isArray, makeArray } from "./util.js";
import { directivesFor } from "./directives.js";
import { matchSubcommand } from "./subcommands.js";
import { OptionScope } from "./scope.js";

const repr = JSON.stringify;

// TODO: one decorators are stable (ts 4.9?), use decorators this file

/**
 * Run a function once for each `args` property in the spec (recursive)
 *
 * This will convert single args to an array with one item.
 */
function forEachArgArray(
  spec: Subcommand,
  fn: (args: Arg[], path: Subcommand[]) => void,
  path: Subcommand[] = [],
): void {
  path = path.concat(spec);
  fn(makeArray(spec.args), path);
  for (const option of makeArray(spec.options)) {
    fn(makeArray(option.args), path);
  }
  for (const subcommand of makeArray(spec.subcommands)) {
    forEachArgArray(subcommand, fn, path);
  }
}

/** Run a function once for each `options` property in the spec (recursive) */
function forEachOptionArray(
  spec: Subcommand,
  fn: (options: Option[], path: Subcommand[]) => void,
  path: Subcommand[] = [],
): void {
  path = path.concat(spec);
  fn(makeArray(spec.options), path);
  for (const subcommand of makeArray(spec.subcommands)) {
    forEachOptionArray(subcommand, fn, path);
  }
}

/**
 * Run a function once for each `subcommands` property in the spec (recursive)
 *
 * This will also run the function for the root spec itself.
 */
function forEachSubcommand(
  spec: Subcommand,
  fn: (spec: Subcommand, path: Subcommand[]) => void,
  path: Subcommand[] = [],
): void {
  path = path.concat(spec);
  fn(spec, path);
  for (const subcommand of makeArray(spec.subcommands)) {
    forEachSubcommand(subcommand, fn, path);
  }
}

function joinNames(names: SingleOrArray<string>) {
  return makeArray(names)
    .sort((a, b) => a.length - b.length)
    .join("|");
}

function isSameName(a: string | readonly string[], b: string | readonly string[]) {
  if (isArray(a) && isArray(b)) {
    return a.every((item) => b.includes(item)) && b.every((item) => a.includes(item));
  }
  // This might compare a string to an array, but if that happens the correct
  // result is `false` anyway, so this behaves correctly
  return a === b;
}

/** Compares spec values by shape. Any two functions count as the same shape. */
function isSameStructure(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "function" && typeof b === "function") return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
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
  if (!parent) return `Command ${namedArrayToString(command)}`;
  const index = makeArray(parent.subcommands).indexOf(command);
  return `Subcommand ${namedArrayToString(...path)} (index ${index})`;
}

/**
 * Run a function once for each option that can be used at each command: its
 * own options and the persistent ones it inherits. A persistent option is
 * visited once for every command it reaches, with the scope of that command,
 * so a check sees the option the way the parser does there. `where` names the
 * option in a message, and says which command it's used in when that isn't
 * the one that defines it.
 */
function forEachOptionInScope(
  spec: Subcommand,
  fn: (option: Option, where: string, scope: OptionScope, path: Subcommand[]) => void,
): void {
  forEachSubcommand(spec, (_command, path) => {
    const scope = OptionScope.at(path);
    for (const option of [...scope.local, ...scope.persistent]) {
      let depth = path.length - 1;
      while (!path[depth].options?.includes(option)) depth--;
      const index = path[depth].options!.indexOf(option);
      const name = `${namedArrayToString(...path.slice(0, depth + 1), option)} (index ${index})`;
      const isOwn = depth === path.length - 1;
      fn(option, isOwn ? `Option ${name}` : `In ${namedArrayToString(...path)}, option ${name}`, scope, path);
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

/** Asserts that `isRepeatable` is only assigned a positive integer */
export function assertRepeatableOptionsArePositiveIntegers(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of options.entries()) {
      if (typeof option.isRepeatable === "number") {
        assert(
          Number.isSafeInteger(option.isRepeatable),
          `The option ${namedArrayToString(...path, option)} (index ${index}) has its \`isRepeatable\` value set to a number that is not an integer`,
        );
        assert(
          !(option.isRepeatable < 1),
          `The option ${namedArrayToString(...path, option)} (index ${index}) has its \`isRepeatable\` value set to a number below 1, which means it can't be used at all`,
        );
        assert(
          option.isRepeatable !== 1,
          `The option ${namedArrayToString(...path, option)} (index ${index}) has its \`isRepeatable\` value set to 1, which is no different that omitting the property entirely`,
        );
      }
    }
  });
}

/** Asserts that options have unique names in their scope */
export function assertOptionsHaveLocallyUniqueNames(spec: Subcommand): void {
  forEachSubcommand(spec, (spec, path) => {
    const optionNames = new Set<string>();
    for (const [index, option] of makeArray(spec.options).entries()) {
      for (const name of makeArray(option.name)) {
        assert(
          !optionNames.has(name),
          `Option ${namedArrayToString(...path, option)} (index ${index}) has a non-unique name, '${name}'. Option names must be unique.`,
        );
        optionNames.add(name);
      }
    }
  });
}

/** Asserts that options don't shadow a persistent option */
export function assertOptionsDoNotShadowPersistentOptions(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    // The persistent options this command inherits from its parents.
    const inherited = OptionScope.at(path.slice(0, -1)).persistent;
    const persistentOptionNames = new Set(inherited.flatMap((option) => makeArray(option.name)));
    for (const [index, option] of makeArray(options).entries()) {
      for (const name of makeArray(option.name)) {
        assert(
          !persistentOptionNames.has(name),
          `The option ${namedArrayToString(...path, option)} (index ${index}) shadows the name of a persistent option, ${repr(name)}. Option names can't shadow persistent options.`,
        );
      }
    }
  });
}

/**
 * Asserts that a subcommand's option isn't a different option with exactly the
 * same names as one on a parent.
 *
 * Parsed values are looked up by name, so that parent's value would be
 * unreadable. A shared name is fine when each option has a name of its own, and
 * when the options are identical, such as an option kept in a constant.
 *
 * This skips persistent parent options, because
 * {@link assertOptionsDoNotShadowPersistentOptions} covers those and
 * `allowShadowingPersistentOptions` opts out of it.
 */
export function assertOptionsHaveDifferentNamesFromParents(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    const parents = path.slice(0, -1);
    for (const [index, option] of options.entries()) {
      for (const parent of parents) {
        for (const parentOption of makeArray(parent.options)) {
          const isClash =
            !parentOption.isPersistent &&
            isSameName(parentOption.name, option.name) &&
            !isSameStructure({ ...parentOption, name: 0 }, { ...option, name: 0 });
          assert(
            !isClash,
            `The option ${namedArrayToString(...path, option)} (index ${index}) has the same names as a different option, ${namedArrayToString(parent, parentOption)}, so the parent's value can't be read. Add a name that only one of them uses.`,
          );
        }
      }
    }
  });
}

/** Asserts that subcommands don't share a name with a sibling subcommand */
export function assertSubcommandsHaveLocallyUniqueNames(spec: Subcommand): void {
  forEachSubcommand(spec, (spec, path) => {
    const names = new Set<string>();
    for (const [index, subcommand] of makeArray(spec.subcommands).entries()) {
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
 * Asserts that option names starting with a single dash aren't longer
 * than two characters, unless parserDirectives.flagsArePosixNoncompliant is
 * set on an ancestor command.
 */
export function assertLongOptionNamesDoNotStartWithSingleDash(spec: Subcommand): void {
  forEachOptionInScope(spec, (option, where, scope) => {
    if (scope.directives.flagsArePosixNoncompliant) return;
    for (const name of makeArray(option.name)) {
      assert(
        !((name.startsWith("-") || name.startsWith("+")) && !name.startsWith("--") && name.length > 2),
        `${where} has a name that the parser is unable to parse, as it starts with a single '${name[0]}'. Tokens starting with that character are interpreted as short options, so passing '${name}' will be interpreted as '${Array.from(name.slice(1), (letter) => name[0] + letter).join(" ")}'. \`parserDirectives.flagsArePosixNoncompliant\` must be \`true\` on an ancestor command.`,
      );
    }
  });
}

/**
 * Asserts that all option names start with dashes
 */
export function assertOptionNamesStartWithDashes(spec: Subcommand): void {
  forEachOptionInScope(spec, (option, where, scope) => {
    if (scope.directives.flagsArePosixNoncompliant) return;
    for (const name of makeArray(option.name)) {
      assert(
        name.startsWith("-") || name.startsWith("+"),
        `${where} doesn't start with a dash or plus, the parser will be unable to find matching options without \`parserDirectives.flagsAreNonPosixCompliant\` being set to 'true' on an ancestor command`,
      );
    }
  });
}

/**
 * Asserts that no option name is one that a subcommand matches, exactly or
 * by a unique prefix. Until an argument is found, the parser reads such a
 * name as the subcommand.
 */
export function assertOptionsDoNotMatchSubcommands(spec: Subcommand): void {
  forEachOptionInScope(spec, (option, where, scope, path) => {
    const subcommands = path[path.length - 1].subcommands;
    if (!subcommands) return;
    for (const name of makeArray(option.name)) {
      // A name that another option shadows is that option's to check.
      if (scope.resolve(name) !== option) continue;
      const subcommand = matchSubcommand(subcommands, name, scope.directives.subcommandsMatchUniquePrefix);
      if (!subcommand) continue;
      assert(
        false,
        `${where} has the name '${name}', which the parser reads as the subcommand ${namedArrayToString(...path, subcommand)} until an argument is found. Rename one of them.`,
      );
    }
  });
}

/**
 * Asserts that nothing is named exactly '--'
 */
export function assertNothingIsNamedDashDash(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of makeArray(options).entries()) {
      for (const name of makeArray(option.name)) {
        assert(
          name !== "--",
          `Option ${namedArrayToString(...path, option)} (index ${index}) is named '--', which is a special instruction to the parser to treat all following tokens as arguments. This will never be matched`,
        );
      }
    }
  });
  forEachSubcommand(spec, (command, path) => {
    for (const name of makeArray(command.name)) {
      assert(
        name !== "--",
        `${describeCommand(path)} is named '--', which is a special instruction to the parser to treat all following tokens as arguments. This will never be matched`,
      );
    }
  });
}

/**
 * Asserts that no option arg separator is an empty string
 */
export function assertOptionArgSeparatorsHaveCharacters(spec: Subcommand): void {
  forEachSubcommand(spec, (command, path) => {
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
 * Asserts that options named "+" or "-" takes one arg
 */
export function assertPlusMinusOptionsTakeOneArg(spec: Subcommand): void {
  forEachOptionInScope(spec, (option, where, scope) => {
    if (scope.directives.flagsArePosixNoncompliant) return;
    for (const name of makeArray(option.name)) {
      if (name !== "-" && name !== "+") continue;
      assert(option.args && !Array.isArray(option.args), `${where} must take exactly one argument`);
    }
  });
}

/**
 * Asserts that names do not have leading or trailing whitespace
 */
export function assertNamesHaveNoExtraWhitespace(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of makeArray(options).entries()) {
      for (const name of makeArray(option.name)) {
        assert(
          name === name.trim(),
          `Option ${namedArrayToString(...path, option)} (index ${index}) has a name with extra whitespace`,
        );
      }
    }
  });
  forEachSubcommand(spec, (command, path) => {
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
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of makeArray(options).entries()) {
      assert(
        option.description,
        `Option ${namedArrayToString(...path, option)} (index ${index}) has no description`,
      );
    }
  });
  forEachSubcommand(spec, (command, path) => {
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
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of makeArray(options).entries()) {
      if (option.description) {
        assert(
          option.description.split("\n").every((line) => line.length <= 68),
          `Option ${namedArrayToString(...path, option)} (index ${index}) has a description line over 68 characters`,
        );
      }
    }
  });
  forEachSubcommand(spec, (command, path) => {
    if (command.description) {
      assert(
        command.description.split("\n").every((line) => line.length <= 68),
        `${describeCommand(path)} has a description line over 68 characters`,
      );
    }
  });
}

export function assertRequiresSeparatorTakesOneArg(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    for (const [index, option] of makeArray(options).entries()) {
      if (option.requiresSeparator) {
        const args = makeArray(option.args);
        assert(
          getMinArgs(args) <= 1,
          `Option ${namedArrayToString(...path, option)} (index ${index}) takes a minimum of ${getMinArgs(args)} arg(s), but because of requiresSeparator, it must instead be 0 or 1`,
        );
        assert(
          getMaxArgs(args) === 1,
          `Option ${namedArrayToString(...path, option)} (index ${index}) takes a maximum of ${getMaxArgs(args)} arg(s), but because of requiresSeparator, it's only able to take 1`,
        );
      }
    }
  });
}

/**
 * Asserts that an option with `requiresSeparator` can be given a value
 * everywhere it can be used: the parser has to split options at the separator
 * it requires, or at any separator when it doesn't name one.
 */
export function assertRequiredSeparatorsAreUsable(spec: Subcommand): void {
  forEachOptionInScope(spec, (option, where, scope) => {
    if (!option.requiresSeparator) return;
    const separators = scope.directives.optionArgSeparators;
    if (option.requiresSeparator === true) {
      assert(separators.length > 0, `${where} requires a separator, but there are no option arg separators`);
    } else {
      const accepted = separators.map((separator) => `'${separator}'`).join(", ");
      assert(
        separators.includes(option.requiresSeparator),
        `${where} requires the separator '${option.requiresSeparator}', but the parser only splits options at ${accepted || "no separators"}`,
      );
    }
  });
}

export function assertCommonOptionsArePersistent(spec: Subcommand): void {
  const failures: [string | readonly string[], string][] = [];
  forEachSubcommand(spec, (subcommand, path) => {
    if (!subcommand.subcommands) {
      return;
    }
    for (const option of makeArray(subcommand.options)) {
      const allChildSubcommands: Subcommand[] = [];
      forEachSubcommand(subcommand, (cmd) => allChildSubcommands.push(cmd));

      const allShareOption = allChildSubcommands.every((cmd) =>
        makeArray(cmd.options).some((o) => isSameName(option.name, o.name)),
      );

      if (allShareOption && !failures.some(([name]) => isSameName(name, option.name))) {
        failures.push([option.name, namedArrayToString(...path, option)]);
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
 * that exist in scope
 */
export function assertOptionNameReferencesExist(spec: Subcommand): void {
  forEachOptionArray(spec, (options, path) => {
    const scope = OptionScope.at(path);
    for (const [index, option] of makeArray(options).entries()) {
      for (const name of makeArray(option.dependsOn)) {
        assert(
          scope.resolve(name) !== null,
          `The option ${namedArrayToString(...path, option)} (index ${index}) depends on an option named ${repr(name)}, which doesn't exist in its scope`,
        );
      }
      for (const name of makeArray(option.exclusiveOn)) {
        assert(
          scope.resolve(name) !== null,
          `The option ${namedArrayToString(...path, option)} (index ${index}) is exclusive on an option named ${repr(name)}, which doesn't exist in its scope`,
        );
      }
    }
  });
}

/**
 * Asserts that commands that will match subcommands by prefix do not take arguments
 */
export function assertPrefixMatchCommandsHaveNoArguments(spec: Subcommand): void {
  forEachSubcommand(spec, (subcommand, path) => {
    // The path ends at this command, so this is the setting that decides how
    // its own subcommands are matched.
    if (!directivesFor(path).subcommandsMatchUniquePrefix) return;

    assert(
      !(subcommand.subcommands && subcommand.args),
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
    [
      "Repeatable options that are numbers are integers greater than 1",
      "assertRepeatableOptionsArePositiveIntegers",
      assertRepeatableOptionsArePositiveIntegers,
      true,
    ],
    [
      "Long option names don't start with a single dash",
      "assertLongOptionNamesDoNotStartWithSingleDash",
      assertLongOptionNamesDoNotStartWithSingleDash,
      true,
    ],
    [
      "Option names all start with dashes",
      "assertOptionNamesStartWithDashes",
      assertOptionNamesStartWithDashes,
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
      "Options don't share a name with a subcommand",
      "assertOptionsDoNotMatchSubcommands",
      assertOptionsDoNotMatchSubcommands,
      true,
    ],
    ["Nothing is named '--'", "assertNothingIsNamedDashDash", assertNothingIsNamedDashDash, true],
    [
      "Option arg separators are not an empty string",
      "assertOptionArgSeparatorsHaveCharacters",
      assertOptionArgSeparatorsHaveCharacters,
      true,
    ],
    [
      "Options named '-' or '+' take exactly one argument",
      "assertPlusMinusOptionsTakeOneArg",
      assertPlusMinusOptionsTakeOneArg,
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
      "Options with `requiresSeparator` take exactly one argument",
      "assertRequiresSeparatorTakesOneArg",
      assertRequiresSeparatorTakesOneArg,
      true,
    ],
    [
      "Options with `requiresSeparator` use a separator the parser accepts",
      "assertRequiredSeparatorsAreUsable",
      assertRequiredSeparatorsAreUsable,
      true,
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
      if (!enabled) continue;
      await runStep(t, namingStyle === "function" ? functionName : sentence, () => check(spec));
    }
  };
}

export const testSpec = test;
