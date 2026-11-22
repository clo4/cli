/**
 * Spec validation for use in a test suite.
 *
 * Checks can become stricter in minor or patch releases to catch incorrect
 * or undefined behavior.
 *
 * @module testing
 */

import type { Arg, Option, SingleOrArray, Spec, Subcommand } from "./types.js";
import { argName, maxArgs, minArgs } from "./args.js";
import { assert, makeArray } from "./util.js";
import { CommandScope, loadAll, optionKey, stubKeys, writeForm } from "./scope.js";
import type { OptionForm } from "./scope.js";
import { optionToString, shownDescription } from "./help.js";
import { tokenReader } from "./parse.js";
import type { TokenReading } from "./parse.js";
import { describeParser } from "./description.js";
import { describeRange } from "./schemas.js";
import { apply, Rejected } from "./values.js";

const repr = JSON.stringify;

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
  private value: string | null = null;

  constructor(
    /** The commands from the root to this one. */
    readonly path: [Subcommand, ...Subcommand[]],
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

  /** A value to write options with here, worked out on first use. See {@link placeholderValue}. */
  get placeholder(): string {
    return (this.value ??= placeholderValue(this.scope));
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
 * The paths the spec checks follow through one spec, walked once for all the
 * checks of a run.
 *
 * The command scope says which subcommands the next token can name at each
 * command, so a path can enter a persistent subcommand from below the command
 * that defines it.
 *
 * The parser can enter more paths than these. A path here has no command
 * twice, and goes through an inherited subcommand at most once, then stays in
 * that subcommand's own commands. So `cli a help` is checked, and `cli a p q`
 * isn't when `a` inherits both `p` and `q`. Without the limit, the paths of a
 * spec with several persistent subcommands multiply. Of 300 random specs with
 * up to 46 commands, the one with the most paths had 44,800 when the only
 * limit was no command twice, and 390 with this one.
 */
class SpecWalk {
  /** A visit for each path, parents before the commands below them. */
  private readonly visits: CommandVisit[] = [];
  private uses: readonly OptionUse[] | null = null;
  private lists: readonly ArgsAt[] | null = null;

  constructor(
    /** The root command. Every path and scope starts there. */
    readonly spec: Subcommand,
    /** What was wrong with the commands that loaded before the walk. See {@link loadProblems}. */
    readonly loadProblems: readonly string[] = [],
  ) {
    const walk = (visit: CommandVisit) => {
      this.visits.push(visit);
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
  }

  /** Each path. A check of what the parser does at a command reads these. */
  get paths(): readonly CommandVisit[] {
    return this.visits;
  }

  /**
   * Each command in the spec, at the path that defines it, parents before
   * their subcommands. A check of how a command is written reads these.
   */
  get commands(): readonly CommandVisit[] {
    return this.visits.filter((visit) => visit.isDefinition);
  }

  /**
   * Each `args` property in the spec, as a list: every command's, then every
   * option's, each at the command that defines it. Built on first use, since
   * the walk doesn't change.
   */
  get argLists(): readonly ArgsAt[] {
    if (this.lists) {
      return this.lists;
    }
    const lists: ArgsAt[] = [];
    for (const { command, path } of this.commands) {
      const where = `In ${namedArrayToString(...path)}, argument`;
      lists.push({ args: makeArray(command.args), option: null, path, where });
    }
    for (const { option, isDefinedHere, path, where } of this.optionUses) {
      if (isDefinedHere) {
        lists.push({ args: makeArray(option.args), option, path, where: `${where}, argument` });
      }
    }
    return (this.lists = lists);
  }

  /**
   * Each option at the end of each path it can be used on: the options the
   * command scope has in effect there, local ones first. A check that is
   * about how the option is written skips the uses that aren't
   * `isDefinedHere`. A check that depends on the scope sees the option the
   * way the parser does at each command. Built on first use, like
   * {@link argLists}.
   */
  get optionUses(): readonly OptionUse[] {
    if (this.uses) {
      return this.uses;
    }
    const uses: OptionUse[] = [];
    for (const visit of this.visits) {
      const { path, scope } = visit;
      const { local, persistent } = scope.live();
      const forms = new Map([...local, ...persistent].map((live) => [live.option, live.forms]));
      // A command can list an option that a command above it lists too. It's
      // one option there, so it's one use.
      for (const option of new Set([...scope.local, ...scope.persistent])) {
        const { definedIn, index } = visit.definition(option);
        const where = describeOption(definedIn, index, path);
        uses.push({
          option,
          visit,
          path,
          scope,
          forms: forms.get(option) ?? [],
          isDefinedHere: visit.isDefinition && definedIn === path,
          where,
        });
      }
    }
    return (this.uses = uses);
  }
}

/** `command` and every command below it in the spec, parents first. */
function commandsFrom(command: Subcommand): Subcommand[] {
  return [command, ...makeArray(command.subcommands).flatMap(commandsFrom)];
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

/** One `args` property in the spec, as a list, at the command that defines it. */
interface ArgsAt {
  args: Arg[];
  /** The option it's of, or null for a command's. */
  option: Option | null;
  /** The commands from the root to the one that defines it. */
  path: Subcommand[];
  /** Names the list at the start of a message. The argument's name goes after it. */
  where: string;
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
   * How each of its names is written there. A name that another option
   * shadows is that option's, so it isn't one of these.
   */
  forms: readonly OptionForm[];
  /**
   * Whether this use is the option's definition: the command it's used in
   * defines it, at the path that defines the command.
   */
  isDefinedHere: boolean;
  /** Names the option at the start of a message. See {@link describeOption}. */
  where: string;
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
  const max = maxArgs(option.args);
  const count = Number.isFinite(max) ? max : minArgs(option.args) + 1;
  return Array.from({ length: count }, () => value);
}

/**
 * Asserts that the parser reads each name of every option the way the name is
 * written. The names-read-back check runs this after it checks subcommands.
 */
async function assertOptionFormsReadBack(walk: SpecWalk): Promise<void> {
  const root = walk.spec as Spec;
  for (const { option, where, scope, forms, path, visit } of walk.optionUses) {
    const before = visit.tokens;
    const values = everyValue(option, visit.placeholder);
    for (const form of forms) {
      const tokens = writeForm(form, values);
      const reader = tokenReader(root);
      for (const token of before) {
        await reader.read(token);
      }
      // A name joined to its value by a separator is a token by itself too.
      const name = form.join ? await reader.peek(form.name) : null;
      const first = await reader.read(tokens[0]);
      // A name joined to its value with nothing between isn't a token by itself.
      if (form.join !== "") {
        // Without a join, the first token is the name.
        const reading = name ?? first;
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
        const reading = await reader.read(tokens[index]);
        assert(
          reading.kind === "value" && reading.option === option,
          `${written}, but in '${tokens.join(" ")}' the parser reads '${tokens[index]}' as ${describeReading(reading, path)}`,
        );
      }
    }
  }
}

/**
 * What's wrong with the command at the end of `path`, which has a `loadSpec`,
 * and with `loaded`, the command that gave. The parser carries on with
 * `loaded` under what the parent read before then.
 */
function loadProblems(path: Subcommand[], loaded: Subcommand): string[] {
  const command = path[path.length - 1];
  const where = describeCommand(path);
  const problems: string[] = [];
  for (const [key, value] of Object.entries(command)) {
    if (value !== undefined && key !== "loadSpec" && !(stubKeys as readonly string[]).includes(key)) {
      problems.push(
        `${where} has a \`loadSpec\` and sets \`${key}\`. Beside a \`loadSpec\`, a command only sets ${stubKeys.map((name) => `\`${name}\``).join(", ")}. Move \`${key}\` to the command it loads.`,
      );
    }
  }
  if (!isSameStructure(makeArray(loaded.name), makeArray(command.name))) {
    problems.push(
      `${where} loads a command named ${repr(loaded.name)}. Give the loaded command the same \`name\`, ${repr(command.name)}.`,
    );
  }
  for (const key of ["description", "hidden", "isPersistent"] as const) {
    if (loaded[key] !== undefined && loaded[key] !== command[key]) {
      problems.push(
        `${where} loads a command whose \`${key}\` is ${repr(loaded[key])}, but its own is ${repr(command[key]) ?? "not set"}, and its own is the one used. Make them the same, or leave \`${key}\` out of the loaded command.`,
      );
    }
  }
  if (loaded.loadSpec !== undefined) {
    problems.push(`${where} loads a command that has a \`loadSpec\` of its own, which is never called.`);
  }
  return problems;
}

export type TestNamingStyle = "sentence" | "function";

/** Configuration for `testSpec`. All validation relaxations default to `false`. */
export interface TestOptions {
  /**
   * Permit commands and options without descriptions. Default: `false`.
   */
  allowNoDescription?: boolean;

  /**
   * Permit description lines longer than 68 characters. Default: `false`.
   * This includes positional argument descriptions.
   */
  allowLongDescriptionLines?: boolean;

  /**
   * Permit positional arguments on commands with prefix matching enabled.
   * A word can then be an argument or a subcommand prefix. Default: `false`.
   */
  allowMatchingSubcommandPrefixAndArgs?: boolean;

  /**
   * Permit a root without a `--help` option, such as `help`. Default: `false`.
   */
  allowNoHelpOption?: boolean;

  /**
   * Permit a root without a `completion` subcommand, such as `completion`.
   * Default: `false`.
   */
  allowNoCompletionCommand?: boolean;

  /**
   * Change the naming style of the tests.
   *
   * - `sentence`: Describe each check in a sentence. This is the default.
   * - `function`: Use the assertion function name.
   */
  namingStyle?: TestNamingStyle;
}

/** Optional test-runner context for reporting checks as named steps. */
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
  /**
   * Throws an error that says what's wrong when the spec fails the check, or
   * gives a promise that rejects with it.
   */
  check(walk: SpecWalk): void | Promise<void>;
}

const specChecks: readonly SpecCheck[] = [
  {
    /*
     * A parent's help and completion show a command's name and description
     * before it loads, and the parser matches its name. So those stay as the
     * command with the `loadSpec` has them, and the loaded command can only
     * say the same. Anything else beside a `loadSpec` would be replaced or
     * left behind when the command loads.
     */
    sentence: "A command with a loadSpec sets only what its parent reads, and loads a command that agrees",
    name: "assertLoadedCommandsMatch",
    check(walk) {
      assert(walk.loadProblems.length === 0, walk.loadProblems[0]);
    },
  },
  {
    sentence: "Required arguments don't follow optional arguments",
    name: "assertRequiredArgumentsDoNotFollowOptionalArguments",
    check(walk) {
      for (const { args, where } of walk.argLists) {
        let remainingMustBeOptional = false;
        let firstOptionalArgIndex: number | null = null;
        for (const [index, arg] of args.entries()) {
          if (remainingMustBeOptional) {
            assert(
              arg.isOptional,
              `${where} ${argName(arg, String(index))} is required, but it must be optional since the argument at index ${firstOptionalArgIndex} is optional`,
            );
          } else if (arg.isOptional) {
            remainingMustBeOptional = true;
            firstOptionalArgIndex ??= index;
          }
        }
      }
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
    check(walk) {
      for (const { args, option, where } of walk.argLists) {
        let firstWithout: number | null = null;
        for (const [index, arg] of args.entries()) {
          if (arg.default === undefined) {
            firstWithout ??= index;
            continue;
          }
          if (arg.isOptional) {
            continue;
          }
          const name = `${where} ${argName(arg, String(index))} has a default, but`;
          assert(option, `${name} it's required, so the default is never used`);
          assert(!option.isRequired, `${name} the option is required, so the default is never used`);
          assert(
            firstWithout === null,
            `${name} the argument at index ${firstWithout} has none, so the default is never used`,
          );
        }
      }
    },
  },
  {
    /*
     * A default goes through its argument's parser when the command-line parser uses it,
     * so one that its parser rejects would fail every command line that
     * leaves the argument out.
     */
    sentence: "Every default passes its argument's parser",
    name: "assertDefaultsPassTheirParse",
    async check(walk) {
      const defaults: { arg: Arg; where: string }[] = [];
      for (const { args, where } of walk.argLists) {
        for (const [index, arg] of args.entries()) {
          defaults.push({ arg, where: `${where} ${argName(arg, String(index))}` });
        }
      }
      for (const { arg, where } of defaults) {
        if (arg.default === undefined || arg.parse === undefined) {
          continue;
        }
        const result = await apply(arg.parse, arg.default);
        assert(
          !(result instanceof Rejected),
          `${where} has the default ${JSON.stringify(arg.default)}, which its parser rejects${
            result instanceof Rejected && result.reason !== "" ? `: ${result.reason}` : ""
          }`,
        );
      }
    },
  },
  {
    /*
     * A schema like `number({ min: 10, max: 1 })` rejects every value, which
     * is a mistake in the spec. It's checked here and not when the schema is
     * made, so a CLI doesn't pay for the check each time it starts.
     */
    sentence: "Every number range has a number in it",
    name: "assertRangesAreNotEmpty",
    check(walk) {
      const check = (arg: Arg, where: string) => {
        const range = describeParser(arg)?.range;
        if (!range) {
          return;
        }
        const { type, bounds } = range;
        const { min, max } = bounds;
        if (min === undefined || max === undefined) {
          return;
        }
        // The least and greatest numbers the range has, for a range of integers.
        const least = type === "integer" ? (bounds.minExclusive ? Math.floor(min) + 1 : Math.ceil(min)) : min;
        const greatest =
          type === "integer" ? (bounds.maxExclusive ? Math.ceil(max) - 1 : Math.floor(max)) : max;
        const hasNone =
          least > greatest ||
          (type === "number" && least === greatest && (bounds.minExclusive || bounds.maxExclusive));
        assert(
          !hasNone,
          `${where} has a parser that rejects every value, since it asks for ${type === "integer" ? "an" : "a"} ${describeRange(type, bounds)}`,
        );
      };
      for (const { args, where } of walk.argLists) {
        for (const [index, arg] of args.entries()) {
          check(arg, `${where} ${argName(arg, String(index))}`);
        }
      }
    },
  },
  {
    sentence: "Repeatable options that are numbers are integers greater than 1",
    name: "assertRepeatableOptionsArePositiveIntegers",
    check(walk) {
      for (const { option, isDefinedHere, where } of walk.optionUses) {
        if (!isDefinedHere || typeof option.isRepeatable !== "number") {
          continue;
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
      }
    },
  },
  {
    sentence: "Options have locally unique names",
    name: "assertOptionsHaveLocallyUniqueNames",
    check(walk) {
      for (const { path, own } of walk.commands) {
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
      }
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
    check(walk) {
      for (const { path, own, parent } of walk.paths) {
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
            // The same object can't have a ref for each place, and needs none.
            assert(
              shadowedOption !== option,
              `${where} is a persistent option that ${namedArrayToString(...path)} already inherits, ${other}. Remove it from ${namedArrayToString(...path)}.`,
            );
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
      }
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
    check(walk) {
      for (const { path, own, onLine } of walk.paths) {
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
      }
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
    check(walk) {
      for (const { path, own, onLine } of walk.paths) {
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
      }
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
    check(walk) {
      const sharing = new Set<Option>();
      const withRef: { option: Option; where: string }[] = [];
      for (const { path, own, onLine, isDefinition } of walk.paths) {
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
      }
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
    check(walk) {
      for (const { command, path } of walk.commands) {
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
      }
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
    async check(walk) {
      const root = walk.spec as Spec;
      for (const { path, scope, tokens: before } of walk.paths) {
        const reader = tokenReader(root);
        for (const token of before) {
          await reader.read(token);
        }
        // An inherited subcommand is checked by the names that still refer to it.
        for (const { command: subcommand, names } of scope.subcommands()) {
          for (const name of names) {
            const reading = await reader.peek(name);
            if (reading.kind === "subcommand" && reading.command === subcommand) {
              continue;
            }
            assert(
              false,
              `${describeCommand([...path, subcommand])} has the name '${name}', but the parser reads it as ${describeReading(reading, path)}`,
            );
          }
        }
      }
      await assertOptionFormsReadBack(walk);
    },
  },
  {
    sentence: "Option arg separators are not an empty string",
    name: "assertOptionArgSeparatorsHaveCharacters",
    check(walk) {
      for (const { command, path } of walk.commands) {
        const separators = makeArray(command.parserDirectives?.optionArgSeparators);
        for (const [sepIndex, separator] of separators.entries()) {
          assert(
            separator !== "",
            `${describeCommand(path)} has an empty string for an option arg separator at index ${sepIndex}. If you wanted to disable option arg separators, use an empty array.`,
          );
        }
      }
    },
  },
  {
    sentence: "Names have no extra leading or trailing whitespace",
    name: "assertNamesHaveNoExtraWhitespace",
    check(walk) {
      for (const { option, isDefinedHere, where } of walk.optionUses) {
        if (!isDefinedHere) {
          continue;
        }
        for (const name of makeArray(option.name)) {
          assert(name === name.trim(), `${where} has a name with extra whitespace`);
        }
      }
      for (const { command, path } of walk.commands) {
        for (const name of makeArray(command.name)) {
          assert(name === name.trim(), `${describeCommand(path)} has a name with extra whitespace`);
        }
      }
      for (const { args, where } of walk.argLists) {
        for (const [index, arg] of args.entries()) {
          assert(
            arg.name === undefined || arg.name === arg.name.trim(),
            `${where} at index ${index} has a name with extra whitespace`,
          );
        }
      }
    },
  },
  {
    sentence: "Everything has a description",
    name: "assertEverythingHasDescription",
    skippedBy: "allowNoDescription",
    check(walk) {
      const spec = walk.spec;
      assert(spec.description, `Spec has no description`);
      for (const { option, isDefinedHere, where } of walk.optionUses) {
        if (isDefinedHere) {
          assert(option.description, `${where} has no description`);
        }
      }
      for (const { command, path } of walk.commands) {
        assert(command.description, `${describeCommand(path)} has no description`);
      }
    },
  },
  {
    sentence: "Each line in descriptions is less than or equal to 68 characters",
    name: "assertDescriptionLineLengthUnder69",
    skippedBy: "allowLongDescriptionLines",
    check(walk) {
      // Each line as help shows it, which for an indented block is without the indentation.
      const fits = (description: string | undefined) =>
        (shownDescription(description) ?? "").split("\n").every((line) => line.length <= 68);
      assert(fits(walk.spec.description), `Spec has a description line over 68 characters`);
      for (const { option, isDefinedHere, where } of walk.optionUses) {
        if (isDefinedHere) {
          assert(fits(option.description), `${where} has a description line over 68 characters`);
        }
      }
      for (const { command, path } of walk.commands) {
        assert(
          fits(command.description),
          `${describeCommand(path)} has a description line over 68 characters`,
        );
        // Help lists positional arguments with their descriptions.
        for (const [index, arg] of makeArray(command.args).entries()) {
          assert(
            fits(arg.description),
            `In ${namedArrayToString(...path)}, argument ${argName(arg, String(index))} has a description line over 68 characters`,
          );
        }
      }
    },
  },
  {
    sentence: "Common options are not defined on every subcommand",
    name: "assertCommonOptionsArePersistent",
    check(walk) {
      const failures: [string, string][] = [];
      for (const { command, path } of walk.commands) {
        if (!command.subcommands) {
          continue;
        }
        // This command's options that every command below it defines too. An
        // option with a ref is a different option from the ones that share its
        // names, so it isn't one a subcommand copied.
        let common = makeArray(command.options).filter((option) => option.ref === undefined);
        for (const below of commandsFrom(command)) {
          const keys = makeArray(below.options).map(optionKey);
          common = common.filter((option) => keys.includes(optionKey(option)));
        }
        for (const option of common) {
          const key = optionKey(option);
          if (!failures.some(([failed]) => failed === key)) {
            failures.push([key, namedArrayToString(...path, option)]);
          }
        }
      }
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
    check(walk) {
      for (const { option, where, scope } of walk.optionUses) {
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
      }
    },
  },
  {
    sentence: "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
    name: "assertPrefixMatchCommandsHaveNoArguments",
    skippedBy: "allowMatchingSubcommandPrefixAndArgs",
    check(walk) {
      for (const { command, path, scope } of walk.paths) {
        // The scope is at this command, so this is the setting that decides how
        // its own subcommands are matched.
        if (!scope.directives.subcommandsMatchUniquePrefix) {
          continue;
        }

        assert(
          !(command.subcommands && command.args),
          `The command ${namedArrayToString(
            ...path,
          )} has at least one argument and subcommand, but matches subcommands based on unique prefixes. To fix this, use \`parserDirectives: { subcommandsMatchUniquePrefix: false }\``,
        );
      }
    },
  },
  {
    sentence: "The root has a --help option",
    name: "assertRootHasHelpOption",
    skippedBy: "allowNoHelpOption",
    check(walk) {
      assert(
        makeArray(walk.spec.options).some((option) => makeArray(option.name).includes("--help")),
        "Spec has no --help option. Add `CLI.help` to its options, or set `allowNoHelpOption` to leave it out.",
      );
    },
  },
  {
    sentence: "The root has a completion subcommand",
    name: "assertRootHasCompletionCommand",
    skippedBy: "allowNoCompletionCommand",
    check(walk) {
      assert(
        makeArray(walk.spec.subcommands).some((command) => makeArray(command.name).includes("completion")),
        "Spec has no completion subcommand. Add `CLI.completion` to its subcommands, or set `allowNoCompletionCommand` to leave it out.",
      );
    },
  },
];

/**
 * Return an async function that validates a spec and throws on failure.
 *
 * Call the returned function from a test and await or return its promise.
 * It loads every command, including commands behind `loadSpec`, and checks
 * names, argument order, defaults, option relationships and references.
 * Persistent subcommands are also checked where descendants inherit them.
 * Paths entering multiple inherited subcommands in succession are not checked.
 *
 * @param spec - The root command to validate. Import it without running the CLI.
 * @param options - Validation relaxations and step naming.
 * @returns A function that runs the checks, optionally in named test-runner steps.
 */
export function test(spec: Subcommand, options: TestOptions = {}): (t?: TestContextLike) => Promise<void> {
  const { namingStyle = "sentence" } = options;
  const checks = specChecks.filter(({ skippedBy }) => !(skippedBy && options[skippedBy]));
  return async (t) => {
    const problems: string[] = [];
    const whole = await loadAll(spec, (path, loaded) => problems.push(...loadProblems(path, loaded)));
    const walk = new SpecWalk(whole, problems);
    for (const { sentence, name, check } of checks) {
      await runStep(t, namingStyle === "function" ? name : sentence, () => check(walk));
    }
  };
}

/** Alias of {@link test}. */
export const testSpec = test;
