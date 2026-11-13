/**
 * Supplementary module to make testing your CLI easier.
 *
 * @module
 */

import type { Arg, Option, SingleOrArray, Spec, Subcommand } from "./types.js";
import { assert, getMaxArgs, getMinArgs, makeArray } from "./util.js";
import { CommandScope, loadAll, optionKey, writeForm } from "./scope.js";
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

/**
 * One command at the end of one path the parser can enter. Everything a spec
 * check knows about what's in effect there, it asks the command scope.
 */
class CommandVisit {
  private built: CommandScope | null = null;

  constructor(
    /** The commands from the root to this one. */
    readonly path: Subcommand[],
    /** The tokens that enter the path: a name the parser reads as each command after the root. */
    readonly tokens: string[],
    /**
     * Whether every command on the path is one of its parent's own
     * subcommands. Otherwise the path enters a persistent subcommand from
     * below the command that defines it, as `cli a help` does.
     */
    readonly isDefinition: boolean,
    /** The visit of the command before this one on the path. */
    readonly parent: CommandVisit | null,
  ) {}

  /** The last command on the path. */
  get command(): Subcommand {
    return this.path[this.path.length - 1];
  }

  /** The options, subcommands and directives in effect here, built on first use. */
  get scope(): CommandScope {
    return (this.built ??= CommandScope.at(this.path));
  }

  /** The path to the command at `depth`, which is the path itself for this command, so a message can tell. */
  private pathTo(depth: number): Subcommand[] {
    return depth === this.path.length - 1 ? this.path : this.path.slice(0, depth + 1);
  }

  /**
   * Where `option`, which is in effect here, is defined: the nearest command
   * on the path that lists it.
   */
  definition(option: Option): Definition {
    for (let depth = this.path.length - 1; depth >= 0; depth--) {
      const index = makeArray(this.path[depth].options).indexOf(option);
      if (index !== -1) {
        return { option, definedIn: this.pathTo(depth), index };
      }
    }
    throw new Error("No command on the path lists the option");
  }

  /** This command's options, in definition order. */
  get own(): Definition[] {
    return makeArray(this.command.options).map((option, index) => ({ option, definedIn: this.path, index }));
  }

  /**
   * Every option that can be on a command line with this command's: the
   * options of each command on the path, root first, persistent or not. The
   * parser keeps the values of every option used on a line in one place,
   * under the option's names and its ref, so these are the options whose
   * names and refs can meet.
   */
  get onLine(): Definition[] {
    return this.path.flatMap((command, depth) => {
      const definedIn = this.pathTo(depth);
      return makeArray(command.options).map((option, index) => ({ option, definedIn, index }));
    });
  }
}

/**
 * Run a function once for each path the spec checks follow from `spec`,
 * parents before the commands below them. The command scope says which
 * subcommands the next token can name at each command, so a path can enter a
 * persistent subcommand from below the command that defines it.
 *
 * The parser can enter more paths than these. A path here has no command
 * twice, and goes through an inherited subcommand at most once, then stays in
 * that subcommand's own commands. So `cli a help` is checked, and `cli a help
 * b help` isn't. Without the limit, the paths of a spec with several
 * persistent subcommands multiply. Of 300 random specs with up to 46
 * commands, the one with the most paths had 44,800 when the only limit was no
 * command twice, and 390 with this one.
 */
function forEachPath(spec: Subcommand, fn: (visit: CommandVisit) => void): void {
  let visits = walks.get(spec);
  if (!visits) {
    visits = [];
    const walk = (visit: CommandVisit) => {
      visits!.push(visit);
      const own = makeArray(visit.command.subcommands);
      for (const { command, names } of visit.scope.subcommands()) {
        const isOwn = own.includes(command);
        if ((isOwn || visit.isDefinition) && !visit.path.includes(command)) {
          const tokens = [...visit.tokens, names[0]];
          walk(new CommandVisit([...visit.path, command], tokens, visit.isDefinition && isOwn, visit));
        }
      }
    };
    walk(new CommandVisit([spec], [], true, null));
    walks.set(spec, visits);
  }
  visits.forEach(fn);
}

/**
 * The visits of each spec walked since `test` last started, so the spec checks
 * of one run walk a spec once.
 */
let walks = new WeakMap<Subcommand, CommandVisit[]>();

/**
 * Run a function once for each command in the spec, at the path that defines
 * it, parents before their subcommands, starting with `spec`. A check of how
 * a command is written uses this. A check of what the parser does there uses
 * {@link forEachPath}.
 */
function forEachCommand(spec: Subcommand, fn: (visit: CommandVisit) => void): void {
  forEachPath(spec, (visit) => {
    if (visit.isDefinition) {
      fn(visit);
    }
  });
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

/**
 * Name the last command on `path` in a message, with its index among its
 * siblings, or the command it's inherited in if the one before it doesn't
 * define it.
 */
function describeCommand(path: readonly Subcommand[]): string {
  const command = path[path.length - 1];
  const parent = path[path.length - 2];
  if (!parent) {
    return `Command ${namedArrayToString(command)}`;
  }
  const index = makeArray(parent.subcommands).indexOf(command);
  if (index === -1) {
    return `In ${namedArrayToString(...path.slice(0, -1))}, persistent subcommand ${namedArrayToString(command)}`;
  }
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
  /** The command it's used in. */
  visit: CommandVisit;
  /** The commands from the root to the one the option is used in. */
  path: Subcommand[];
  /** The options and directives in effect there. */
  scope: CommandScope;
  /**
   * Whether this use is the option's definition: the command it's used in
   * defines it, at the path that defines the command.
   */
  isDefinedHere: boolean;
  /** Names the option at the start of a message. See {@link describeOption}. */
  where: string;
}

/**
 * Run a function once for each option at the end of each path it can be used
 * on: the options the command scope has in effect there, local ones first. A
 * check that is about how the option is written skips the uses that aren't
 * `isDefinedHere`. A check that depends on the scope sees the option the way
 * the parser does at each command.
 */
function forEachOption(spec: Subcommand, fn: (use: OptionUse) => void): void {
  forEachPath(spec, (visit) => {
    const { path, scope } = visit;
    // A command can list an option that a command above it lists too. It's
    // one option there, so it's one use.
    for (const option of new Set([...scope.local, ...scope.persistent])) {
      const { definedIn, index } = visit.definition(option);
      const where = describeOption(definedIn, index, path);
      fn({ option, visit, path, scope, isDefinedHere: visit.isDefinition && definedIn === path, where });
    }
  });
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
 * A value for writing options with at the command `scope` is for. No name
 * there starts with it, or with it after '-' or '+', so the parser can only
 * read it as a value.
 */
function placeholderValue(scope: CommandScope): string {
  const names = [
    ...[...scope.local, ...scope.persistent].flatMap((option) => makeArray(option.name)),
    ...scope.subcommands().flatMap((subcommand) => subcommand.names),
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
 * `value` once for every value `option` takes, or for one more than its
 * minimum if it takes any number.
 */
function everyValue(option: Option, value: string): string[] {
  const max = getMaxArgs(option.args);
  const count = Number.isFinite(max) ? max : getMinArgs(option.args) + 1;
  return Array.from({ length: count }, () => value);
}

/**
 * Asserts that the parser reads each name of every option the way the name is
 * written. The names-read-back check runs this after it checks subcommands.
 */
function assertOptionFormsReadBack(spec: Subcommand) {
  const root = spec as Spec;
  forEachOption(spec, ({ option, where, scope, path, visit }) => {
    const before = visit.tokens;
    const values = everyValue(option, placeholderValue(scope));
    // A name that another option shadows is that option's to check.
    const names = makeArray(option.name).filter((name) => scope.resolve(name) === option);
    for (const form of scope.forms(option, names)) {
      const tokens = writeForm(form, values);
      const reader = tokenReader(root);
      for (const token of before) {
        reader.read(token);
      }
      const first = reader.read(tokens[0]);
      // A name joined to its value with nothing between isn't a token by itself.
      if (form.join !== "") {
        // Without a join, the first token is the name.
        const reading = form.join === null ? first : readToken(root, before, form.name);
        assert(
          readsAs(reading, option),
          `${where} has the name '${form.name}', but the parser reads it as ${describeReading(reading, path)}`,
        );
      }
      const written = `${where} is written '${optionToString(option, [form])}'`;
      if (form.join) {
        assert(
          scope.directives.optionArgSeparators.includes(form.join),
          `${written}, but '${form.join}' isn't one of the option arg separators there (${scope.directives.optionArgSeparators.map((separator) => `'${separator}'`).join(", ") || "none"}). Add it to \`parserDirectives.optionArgSeparators\`.`,
        );
      }
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

export type TestNamingStyle = "sentence" | "function";

/** Options that can be provided to `test` */
export interface TestOptions {
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

/** One spec check. `test` runs the checks in table order. */
interface SpecCheck {
  /** The step name with `namingStyle: "sentence"`. */
  sentence: string;
  /**
   * The step name with `namingStyle: "function"`. Users see it in their test
   * output, so it stays the same between releases.
   */
  name: string;
  /** The option that turns the check off when it's true. */
  skippedBy?: Exclude<keyof TestOptions, "namingStyle">;
  /** Throws an error that says what's wrong when the spec fails the check. */
  check(spec: Subcommand): void;
}

const specChecks: readonly SpecCheck[] = [
  {
    sentence: "Required arguments don't follow optional arguments",
    name: "assertRequiredArgumentsDoNotFollowOptionalArguments",
    check(spec) {
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
    },
  },
  {
    /*
     * A positional argument with a default must be optional. A required option
     * argument's default is only used when the option is left out, so every
     * argument before it needs a default too, and the option can't be required.
     */
    sentence: "The parser can use every default",
    name: "assertDefaultsCanBeUsed",
    check(spec) {
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
    },
  },
  {
    sentence: "Repeatable options that are numbers are integers greater than 1",
    name: "assertRepeatableOptionsArePositiveIntegers",
    check(spec) {
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
    },
  },
  {
    sentence: "Options have locally unique names",
    name: "assertOptionsHaveLocallyUniqueNames",
    check(spec) {
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
    },
  },
  {
    /*
     * A subcommand's option that takes a name of a persistent option hides
     * that name of the inherited one, and the two then store their values
     * under the same name. With a ref on each, an action can still read
     * either one.
     */
    sentence: "An option that shadows a persistent option has a ref, and so does the option it shadows",
    name: "assertShadowingOptionsHaveRefs",
    check(spec) {
      forEachPath(spec, ({ path, own, parent }) => {
        // The persistent options of the commands above, which this command's
        // options take names from.
        const inherited = parent?.scope.persistent ?? [];
        for (const { option, index } of own) {
          for (const name of makeArray(option.name)) {
            const shadowedOption = inherited
              .filter((persistent) => makeArray(persistent.name).includes(name))
              .at(-1);
            if (!shadowedOption) {
              continue;
            }
            const shadowed = parent!.definition(shadowedOption);
            const where = describeOption(path, index);
            const other = describeOption(shadowed.definedIn, shadowed.index);
            assert(
              option.ref !== undefined,
              `${where} shadows the name ${repr(name)} of a persistent option, ${other}. Give it a \`ref\` so an action can read it.`,
            );
            assert(
              shadowedOption.ref !== undefined,
              `${other} has its name ${repr(name)} shadowed by ${where}. Give it a \`ref\` so an action can read it.`,
            );
          }
        }
      });
    },
  },
  {
    /*
     * When a subcommand's option and a different option on a parent share a
     * name, each of them needs a name of its own.
     *
     * Parsed values are looked up by name, and an option sets every one of its
     * names when it's used. If every name of the parent's option is also the
     * subcommand's, using the subcommand's option replaces the parent's value,
     * so it can't be read. If every name of the subcommand's option is also the
     * parent's, its names hold the parent's value when it isn't used, so it
     * can't tell whether it was. Options with the same names are fine when
     * they're identical, such as an option kept in a constant, because the
     * parser treats them as one option.
     *
     * Two options that each have a ref are fine too, because each is read by
     * its ref.
     *
     * This skips persistent parent options. The check that shadowing options
     * have refs covers those.
     */
    sentence: "Different options on a subcommand and its parents have different names",
    name: "assertOptionsHaveDifferentNamesFromParents",
    check(spec) {
      forEachPath(spec, ({ path, own, onLine }) => {
        for (const { option, index } of own) {
          const where = describeOption(path, index);
          const names = makeArray(option.name);
          // A parent's non-persistent options aren't in this command's scope,
          // but they can be on the same command line.
          for (const { option: parentOption, definedIn } of onLine) {
            if (
              definedIn === path ||
              parentOption.isPersistent ||
              (parentOption.ref !== undefined && option.ref !== undefined)
            ) {
              continue;
            }
            const parentNames = makeArray(parentOption.name);
            const other = namedArrayToString(definedIn[definedIn.length - 1], parentOption);
            if (optionKey(parentOption) === optionKey(option)) {
              assert(
                isSameStructure({ ...parentOption, name: 0 }, { ...option, name: 0 }),
                `${where} has the same names as a different option, ${other}, so the parent's value can't be read. Add a name that only one of them uses, or give each a \`ref\`.`,
              );
              continue;
            }
            assert(
              !parentNames.every((name) => names.includes(name)),
              `${where} has every name of a different option, ${other}, so the parent's value can't be read. Add a name that only the parent's option uses, or give each a \`ref\`.`,
            );
            assert(
              !names.every((name) => parentNames.includes(name)),
              `${where} only has names of a different option, ${other}, so it can't tell whether it was used. Add a name that only the subcommand's option uses, or give each a \`ref\`.`,
            );
          }
        }
      });
    },
  },
  {
    /*
     * Values are stored under an option's names and under its ref, so a ref
     * that another option on the same command line uses, as a ref or as a
     * name, would hold that option's values too. Only a command and the
     * commands above it are on one command line, so options on sibling
     * commands can have the same ref, as `git -C dir switch -C branch` and
     * `git -C dir branch -C old new` would.
     */
    sentence: "No option a ref can meet on a command line has the same ref, or has it as a name",
    name: "assertRefsAreUnique",
    check(spec) {
      forEachPath(spec, ({ path, own, onLine }) => {
        const met = onLine.map(({ option, definedIn, index }) => ({
          option,
          where: describeOption(definedIn, index),
        }));
        for (const { option, index } of own) {
          const where = describeOption(path, index);
          const ref = option.ref;
          assert(ref !== "", `${where} has an empty \`ref\`.`);
          for (const other of met) {
            if (other.option === option) {
              continue;
            }
            const names = makeArray(other.option.name);
            if (ref !== undefined) {
              assert(
                !names.includes(ref),
                `${where} has the ref ${repr(ref)}, which is a name of ${other.where}.`,
              );
              assert(
                other.option.ref !== ref,
                `${where} has the ref ${repr(ref)}, which ${other.where} has too. Options that can be on one command line need different refs.`,
              );
            }
            const otherRef = other.option.ref;
            assert(
              otherRef === undefined || !makeArray(option.name).includes(otherRef),
              `${where} has the name ${repr(otherRef)}, which is the ref of ${other.where}.`,
            );
          }
          if (ref !== undefined) {
            assert(
              !makeArray(option.name).includes(ref),
              `${where} has the ref ${repr(ref)}, which is one of its own names.`,
            );
          }
        }
      });
    },
  },
  {
    /*
     * A ref is only for telling apart two options that share a name. Anywhere
     * else, the option's name already reads it, and a ref would be a second
     * way to write the same thing.
     */
    sentence: "Only an option that shares a name with an option above or below it has a ref",
    name: "assertRefsAreNeeded",
    check(spec) {
      const sharing = new Set<Option>();
      const withRef: { option: Option; where: string }[] = [];
      forEachPath(spec, ({ path, own, onLine, isDefinition }) => {
        for (const { option, index } of own) {
          if (option.ref !== undefined && isDefinition) {
            withRef.push({ option, where: describeOption(path, index) });
          }
          const names = makeArray(option.name);
          for (const { option: other, definedIn } of onLine) {
            if (
              definedIn !== path &&
              other !== option &&
              makeArray(other.name).some((name) => names.includes(name))
            ) {
              sharing.add(option).add(other);
            }
          }
        }
      });
      for (const { option, where } of withRef) {
        assert(
          sharing.has(option),
          `${where} has a \`ref\`, but shares no name with an option on a command above or below it. Remove the \`ref\` and read the option by its name.`,
        );
      }
    },
  },
  {
    sentence: "Subcommands have locally unique names",
    name: "assertSubcommandsHaveLocallyUniqueNames",
    check(spec) {
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
    },
  },
  {
    /*
     * Each name of a subcommand enters that subcommand, and each name of an
     * option uses that option, at every command the option can be used in.
     * Each option is also written the way help shows it, with every value it
     * takes, and the parser has to read all of those values as the option's.
     */
    sentence: "The parser reads every option and subcommand the way it's written",
    name: "assertNamesReadBack",
    check(spec) {
      const root = spec as Spec;
      forEachPath(spec, ({ path, scope, tokens: before }) => {
        // An inherited subcommand is checked by the names that still refer to it.
        for (const { command: subcommand, names } of scope.subcommands()) {
          for (const name of names) {
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
      assertOptionFormsReadBack(spec);
    },
  },
  {
    sentence: "Option arg separators are not an empty string",
    name: "assertOptionArgSeparatorsHaveCharacters",
    check(spec) {
      forEachCommand(spec, ({ command, path }) => {
        const separators = makeArray(command.parserDirectives?.optionArgSeparators);
        for (const [sepIndex, separator] of separators.entries()) {
          assert(
            separator !== "",
            `${describeCommand(path)} has an empty string for an option arg separator at index ${sepIndex}. If you wanted to disable option arg separators, use an empty array.`,
          );
        }
      });
    },
  },
  {
    sentence: "Names have no extra leading or trailing whitespace",
    name: "assertNamesHaveNoExtraWhitespace",
    check(spec) {
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
    },
  },
  {
    sentence: "Everything has a description",
    name: "assertEverythingHasDescription",
    skippedBy: "allowNoDescription",
    check(spec) {
      assert(spec.description, `Spec has no description`);
      forEachOption(spec, ({ option, isDefinedHere, where }) => {
        if (isDefinedHere) {
          assert(option.description, `${where} has no description`);
        }
      });
      forEachCommand(spec, ({ command, path }) => {
        assert(command.description, `${describeCommand(path)} has no description`);
      });
    },
  },
  {
    sentence: "Each line in descriptions is less than or equal to 68 characters",
    name: "assertDescriptionLineLengthUnder69",
    skippedBy: "allowLongDescriptionLines",
    check(spec) {
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
    },
  },
  {
    sentence: "Common options are not defined on every subcommand",
    name: "assertCommonOptionsArePersistent",
    check(spec) {
      const failures: [string, string][] = [];
      forEachCommand(spec, ({ command, path }) => {
        if (!command.subcommands) {
          return;
        }
        // This command's options that every command below it defines too. An
        // option with a ref is a different option from the ones that share its
        // names, so it isn't one a subcommand copied.
        let common = makeArray(command.options).filter((option) => option.ref === undefined);
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
    },
  },
  {
    // This checks each option at every command it can be used in.
    sentence: "References to other options by name are valid",
    name: "assertOptionNameReferencesExist",
    check(spec) {
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
    },
  },
  {
    sentence: "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
    name: "assertPrefixMatchCommandsHaveNoArguments",
    skippedBy: "allowMatchingSubcommandPrefixAndArgs",
    check(spec) {
      forEachPath(spec, ({ command, path, scope }) => {
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
    },
  },
];

/**
 * Validate your CLI in your test suite
 *
 * This enforces certain constraints that the type system cannot. The parser
 * may ignore these issues, producing correct output that _appears_ to be
 * wrong.
 */
export function test(spec: Subcommand, options: TestOptions = {}): (t?: TestContextLike) => Promise<void> {
  const { namingStyle = "sentence" } = options;
  const checks = specChecks.filter(({ skippedBy }) => !(skippedBy && options[skippedBy]));
  return async (t) => {
    await loadAll(spec);
    walks = new WeakMap();
    for (const { sentence, name, check } of checks) {
      await runStep(t, namingStyle === "function" ? name : sentence, () => check(spec));
    }
  };
}

export const testSpec = test;
