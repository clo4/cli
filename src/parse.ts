import type { Action, Arg, CommandPath, Option, OptionArgs, Spec, Subcommand, SuggestInit } from "./types.js";
import { addDefaults, argAt, hasParse, maxArgs, minArgs, unusedDefaults } from "./args.js";
import { asArray, print } from "./util.js";
import {
  missingOption,
  ParseError,
  problemsError,
  takesNoArguments,
  tooFewArguments,
  tooFewOptionArguments,
  tooManyArguments,
  unknownOption,
} from "./errors.js";
import type { ErrorContext } from "./errors.js";
import type { Directives } from "./directives.js";
import { anyName, CommandScope, exactName, optionKey } from "./scope.js";
import type { LiveSubcommand, OptionForm, SubcommandMatching } from "./scope.js";
import { parseValues } from "./values.js";
import type { ParsedUse } from "./values.js";

export interface ParseResult {
  /** The positional arguments: each one a string, or what its parser gave. */
  args: unknown[];
  argSeparatorIndex: number;
  /** The options used, as the action receives them. */
  options: OptionArgs<unknown>;
  path: CommandPath;
  /**
   * The action to run: the last option action used, or else the selected
   * command's action. A command without an action prints its help.
   */
  action: Action;
}

/** What the token after a command line can be, as the parser would read it. */
export interface NextToken {
  /**
   * What the line before the token gives a suggester. It's a copy, so reading
   * the token doesn't change it.
   */
  line: Omit<SuggestInit, "word">;
  /** The directives in effect. */
  directives: Readonly<Directives>;
  /** Whether the token can be an option. */
  optionsAllowed: boolean;
  /**
   * The subcommands the token can name, hidden ones included, each with the
   * names that still refer to it. While the open option can still take a
   * value, only an exact name matches.
   */
  subcommands: readonly LiveSubcommand[];
  /**
   * The options the token can use, hidden ones included, local options first.
   * Empty when the token can't be an option.
   */
  options: readonly UsableOption[];
  /** The open option, if the token can be its value, and whether it must be. */
  value: { option: Option; arg: Arg | undefined; required: boolean } | null;
  /** The argument the token fills if it isn't an option, subcommand or value. */
  arg: Arg | undefined;
  /**
   * The partial token, if the parser reads it as an option with a value
   * attached. `prefix` is everything before the value.
   */
  attached: { option: Option; arg: Arg; prefix: string; value: string } | null;
  /**
   * Whether the parser reads the partial token as an option, known or
   * unknown, or as `--`. If it doesn't, the token is a value, argument or
   * subcommand.
   */
  partialIsOption: boolean;
}

/**
 * An option the next token can use without going over its repeat limit or
 * breaking an `exclusiveOn` rule.
 */
export interface UsableOption {
  option: Option;
  /**
   * How each name the parser reads as this option here is written. A name
   * that another option shadows, or that a subcommand matches, isn't one of
   * them.
   */
  forms: readonly OptionForm[];
  /**
   * Whether the option was used earlier on the line. Options with the same
   * names count as the same option, like a subcommand's copy of a parent's.
   */
  used: boolean;
}

/** What the parser read one token as. See {@link readToken}. */
export type TokenReading =
  /** `--`, the end of options. */
  | { kind: "separator" }
  | { kind: "subcommand"; command: Subcommand }
  /**
   * One option, or several chained short options, in the order used. If the
   * token also carries a value the option accepts, `attached` says where it starts.
   */
  | { kind: "options"; options: readonly Option[]; attached: { option: Option; start: number } | null }
  /** A value of the option before it. */
  | { kind: "value"; option: Option }
  | { kind: "argument" }
  /** An option that doesn't exist. */
  | { kind: "unknown" };

// The readings that carry nothing else, made once and shared.
const separatorReading: TokenReading = Object.freeze({ kind: "separator" });
const argumentReading: TokenReading = Object.freeze({ kind: "argument" });
const unknownReading: TokenReading = Object.freeze({ kind: "unknown" });

/** The values a repeatable option has collected, and how many times it's been used. */
interface RepeatedUses {
  values: string[];
  count: number;
}

/**
 * How many times `option` can be used. Copies of an option with the same
 * names share their uses, but each copy keeps its own limit.
 */
function repeatLimit(option: Option): number {
  return typeof option.isRepeatable === "number" ? option.isRepeatable : Infinity;
}

/**
 * The last option used, which later tokens can be values of. `count` is how
 * many separate tokens it has taken as values, `min` how many it needs, and
 * `separateMax` how many it can take.
 */
interface OpenOption {
  readonly option: Option | null;
  readonly name: string;
  count: number;
  min: number;
  separateMax: number;
}

/** The state when no option is open. It's frozen because every scanner shares it. */
const noOpenOption: OpenOption = Object.freeze({ option: null, name: "", count: 0, min: 0, separateMax: 0 });

/** The context of an error at the end of `path`, with a copy of the path. */
function contextAt(path: CommandPath): ErrorContext {
  return { path: [...path] };
}

/**
 * An option used that has a `dependsOn` or `exclusiveOn` rule, with the option
 * each name in the rule refers to at the command the option was used in, or
 * null for a name that refers to none there. A name means what it means to the
 * option's own command, so a parent's option that isn't persistent is out of a
 * subcommand's reach, and a name a subcommand's option has taken still means
 * the parent's option to the parent's.
 */
interface UsedRules {
  option: Option;
  needs: readonly (Option | null)[];
  excludes: readonly (Option | null)[];
}

/** The key of each option in `seenOptions`. See {@link optionKey}. */
function usedKeys(seenOptions: readonly Option[]): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < seenOptions.length; i++) {
    used.add(optionKey(seenOptions[i]));
  }
  return used;
}

/**
 * Add each `dependsOn` or `exclusiveOn` rule the options used break to
 * `problems`, and return it. `path` ends at the current command.
 */
function checkOptionRules(
  rules: readonly UsedRules[],
  seenOptions: readonly Option[],
  path: CommandPath,
  problems: ParseError[] | null,
): ParseError[] | null {
  const used = usedKeys(seenOptions);
  for (let i = 0; i < rules.length; i++) {
    const { option, needs } = rules[i];
    for (let j = 0; j < needs.length; j++) {
      const need = needs[j];
      if (!need || !used.has(optionKey(need))) {
        (problems ??= []).push(
          new ParseError(
            contextAt(path),
            `${asArray(option.name).join("/")} requires ${option.dependsOn![j]}, add it to fix this error`,
          ),
        );
      }
    }
  }
  // Two options that exclude each other are one problem.
  let reported: Set<string> | null = null;
  for (let i = 0; i < rules.length; i++) {
    const { option, excludes } = rules[i];
    for (let j = 0; j < excludes.length; j++) {
      const excluded = excludes[j];
      if (!excluded || !used.has(optionKey(excluded))) {
        continue;
      }
      const pair = [optionKey(option), optionKey(excluded)].sort().join("\n");
      if (reported?.has(pair)) {
        continue;
      }
      (reported ??= new Set()).add(pair);
      (problems ??= []).push(
        new ParseError(
          contextAt(path),
          `${asArray(option.name).join("/")} can't be used together with ${option.exclusiveOn![j]}`,
        ),
      );
    }
  }
  return problems;
}

/**
 * Add each option that `scope` requires and that's missing to `problems`,
 * and return it. `path` ends at the command `scope` is for.
 */
function checkRequiredOptions(
  options: ReadonlyMap<string, unknown[]>,
  scope: CommandScope,
  path: CommandPath,
  problems: ParseError[] | null,
): ParseError[] | null {
  // Checking local options first reports a missing local option before a
  // missing persistent one.
  const { local, persistent } = scope;
  for (let i = 0; i < local.length + persistent.length; i++) {
    const option = i < local.length ? local[i] : persistent[i - local.length];
    if (!option.isRequired) {
      continue;
    }
    const names = option.name;
    if (typeof names === "string") {
      if (!options.has(names)) {
        (problems ??= []).push(new ParseError(contextAt(path), missingOption(names)));
      }
      continue;
    }
    for (let j = 0; j < names.length; j++) {
      if (!options.has(names[j])) {
        (problems ??= []).push(new ParseError(contextAt(path), missingOption(names[j])));
        break;
      }
    }
  }
  return problems;
}

/**
 * The options used, as an action asks about them. `options` has every name of
 * each option used, and `scope` is for the selected command, which decides
 * the option each unused name refers to. `defaults` is what the defaults of
 * the unused options parsed to, if an argument's parser ran. Each function is a property
 * of the object, so an action can take one off it and call it alone. A cold
 * parse only makes the object, and each function compiles the first time it's
 * called.
 */
function optionArgs(
  options: Map<string, unknown[]>,
  scope: CommandScope,
  defaults: Map<Option, unknown[]> | null,
): OptionArgs<unknown> {
  return {
    options,
    has: (name) => options.has(name),
    // The spec's types, or the caller, say what each value is. See `OptionArgs`.
    get: <Read>(name: string) => (options.get(name) ?? unusedValues(scope, name, defaults))?.[0] as Read,
    all: <Read>(name: string) => (options.get(name) ?? unusedValues(scope, name, defaults) ?? []) as Read[],
    // A repeatable option without arguments stores an empty string for each
    // use, so its values count the uses.
    count: (name) => options.get(name)?.length ?? 0,
  };
}

/**
 * The defaults of the option `name` refers to at the command `scope` is for,
 * by name or by ref, when no option of that name was used: what `parsed` has
 * for it, or else its defaults as written. See {@link unusedDefaults}.
 */
function unusedValues(
  scope: CommandScope,
  name: string,
  parsed: Map<Option, unknown[]> | null,
): unknown[] | undefined {
  const option = scope.resolve(name) ?? scope.withRef(name);
  return option ? (parsed?.get(option) ?? unusedDefaults(option)) : undefined;
}

/** The action of a command that has none of its own: print the command's help. */
export const usage: Action = ({ help }) => {
  print(help().trimEnd());
  return 0;
};

/** Where the names after a help command lead. See {@link readHelpNames}. */
export interface HelpNames {
  /** The commands from the root to the one whose help prints. */
  path: CommandPath;
  /** The error help reports if a name is an unknown or ambiguous command. */
  error: ParseError | null;
  /**
   * The subcommands the next name can lead to, hidden ones included, each
   * with the names that still refer to it. Empty once the names have ended.
   */
  subcommands: readonly LiveSubcommand[];
}

/** Reads a command line one token at a time. See {@link tokenReader}. */
export interface TokenReader {
  /**
   * Read the next token of the line, and say what it was read as, once the
   * command the token before it entered has loaded.
   */
  read(token: string): Promise<TokenReading>;
}

/**
 * The state of reading one command line, one token at a time. The scope says
 * what each token means at the current command, and this is the only code
 * that decides what the token is read as and keeps what that changes. It
 * never throws: it skips whatever is invalid and keeps going, so
 * {@link readNext} can still read a line that's wrong at the moment, and it
 * keeps the first problem it finds for {@link parse} to throw.
 */
class Scanner {
  // The last option action used.
  private optionAction: Action | undefined = undefined;
  private readonly args: string[] = [];
  // The values of each name used. They're strings until `finish` runs each argument's parser.
  private readonly options: Map<string, unknown[]> = new Map();
  private readonly seenOptions: Option[] = [];
  private argSeparatorIndex = -1;

  // What the current command allows, and the commands from the root to it.
  private readonly scope: CommandScope<Spec>;
  private readonly directives: Directives;

  private hasFoundArg = false;
  // The rules of the options used that have any, or null until one is used.
  private rules: UsedRules[] | null = null;
  // Whether the next token can be an option. It can't after `--`, or after
  // the first argument when the command's options must precede arguments.
  private optionsAllowed = true;

  // The last option used. While it has room, a token that isn't an option or
  // `--` becomes its value. A subcommand's exact name ends it unless a value
  // is required. `useOption` sets it, and `--` or a subcommand closes it.
  private open: OpenOption = noOpenOption;

  // The values of the last option, checked against its arity when it ends.
  // Unlike the open option's counts, this includes values attached with a separator.
  // A repeatable option keeps adding to the same array, so this use's values
  // start at `valuesStart`.
  private values: string[] | null = null;
  private valuesStart = 0;
  private valuesMin = 0;
  private valuesMax = 0;
  private valueArgs: Option["args"] = undefined;

  // The first token that can't be read the way it's written, like an unknown
  // option or a value an option doesn't take. `parse` stops there.
  private problem: ParseError | null = null;

  // The load of the command just entered, if its `loadSpec` returned a
  // promise. Nothing can be read until it settles, so `settle` waits for it
  // before the next token.
  private pending: Promise<void> | null = null;

  // The first argument past the command's limit, and the first name of a
  // subcommand that didn't match. They're only errors once the whole line is
  // read, because an option action like --help allows them. A name that
  // didn't match always comes before an argument past the limit.
  private tooManyArgs: ParseError | null = null;
  private unmatched: ParseError | null = null;

  // Each use of an option whose argument has a parser, or null until one is used.
  private uses: ParsedUse[] | null = null;

  // The uses of each repeatable option, keyed by `optionKey`, or null until
  // one is used. A subcommand's copy of a parent's option has the same names,
  // so it continues the parent's uses. An option with other names, even a
  // subset, has uses of its own.
  private repeatedUses: Map<string, RepeatedUses> | null = null;

  constructor(spec: Spec) {
    this.scope = new CommandScope(spec);
    this.directives = this.scope.directives;
  }

  /**
   * Read each of `tokens` in turn, waiting after each one for the command it
   * entered to load. If `strict`, throw the first problem as soon as it's found.
   */
  async readAll(tokens: readonly string[], strict: boolean): Promise<void> {
    for (let i = 0; i < tokens.length; i++) {
      this.read(tokens[i]);
      if (strict && this.problem) {
        throw this.problem;
      }
      if (this.pending) {
        await this.settle();
      }
    }
  }

  /**
   * Wait for the command the last token entered to load, so the next token
   * can be read. It's a method of its own so that a cold parse that waits for
   * nothing doesn't compile it.
   */
  async settle(): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    await pending;
  }

  // A copy of the path, since reading carries on after a problem and can
  // enter a subcommand before the error is made.
  private ctx(): ErrorContext {
    return contextAt(this.scope.path);
  }

  /** Keep the problem `message` describes if it's the first. */
  private fail(message: string): void {
    this.problem ??= new ParseError(this.ctx(), message);
  }

  /** Keep the first argument the command has no room for, like {@link fail}. */
  private failArgs(message: string): void {
    this.tooManyArgs ??= new ParseError(this.ctx(), message);
  }

  private unknownOption(option: string): void {
    this.problem ??= unknownOption(option, this.scope.suggestionNames(), this.ctx());
  }

  // Every token except an option's value, or an unknown option, ends the
  // previous option. Then the defaults of the optional arguments that weren't
  // given are added, so a bare `--inspect` gets its port.
  private endOption(): void {
    const values = this.values;
    if (values) {
      const typedEnd = values.length;
      const given = typedEnd - this.valuesStart;
      if (given < this.valuesMin) {
        this.failTooFewValues();
      } else {
        addDefaults(values, this.valueArgs, given);
      }
      if (hasParse(this.valueArgs)) {
        this.noteUse(values, typedEnd);
      }
    }
    this.values = null;
  }

  /**
   * Keep the values the open option just finished taking, for its parser.
   * It's a method of its own so that a cold parse of a line without such an
   * option doesn't compile it.
   */
  private noteUse(values: string[], typedEnd: number): void {
    const { option, name } = this.open;
    (this.uses ??= []).push({
      option: option!,
      name,
      values,
      start: this.valuesStart,
      typedEnd,
      end: values.length,
    });
  }

  /**
   * Keep the problem of an open option given too few values, like
   * {@link fail}. It's a method of its own so that a cold parse where every
   * option gets its values doesn't compile it.
   */
  private failTooFewValues(): void {
    this.fail(tooFewOptionArguments(this.open.name, this.valuesMin, this.valuesMax));
  }

  private useOption(option: Option, name: string): void {
    this.endOption();
    const valuesMin = minArgs(option.args);
    const valuesMax = maxArgs(option.args);
    // Options that require a separator only take attached values.
    const separateMax = option.requiresSeparator ? 0 : valuesMax;
    this.open = { option, name, count: 0, min: valuesMin, separateMax };
    this.seenOptions.push(option);
    if (option.action) {
      this.optionAction = option.action;
    }
    if (option.dependsOn || option.exclusiveOn) {
      this.noteRules(option);
    }
    // A repeatable option collects the values from every use. Otherwise the
    // last use of an option wins, so a user can override a flag that a shell
    // alias already sets.
    const optionValues = option.isRepeatable ? this.repeatUse(option) : [];
    // A repeatable option stores its values again on each use, because another
    // option may have taken one of its names since the last use.
    const names = option.name;
    if (typeof names === "string") {
      this.options.set(names, optionValues);
    } else {
      for (let i = 0; i < names.length; i++) {
        this.options.set(names[i], optionValues);
      }
    }
    // An option that shares a name with another one is read by its ref, which
    // no other option sets.
    if (option.ref !== undefined) {
      this.options.set(option.ref, optionValues);
    }
    // Each use of a repeatable option without arguments adds an empty string,
    // so its values count the uses.
    if (option.isRepeatable && !option.args) {
      optionValues.push("");
      return;
    }

    this.valuesMin = valuesMin;
    this.valuesMax = valuesMax;
    if (valuesMax > 0) {
      this.values = optionValues;
      this.valuesStart = optionValues.length;
      this.valueArgs = option.args;
    }
  }

  /**
   * Keep what the rules of `option` refer to at the current command, where it
   * was just used. It's a method of its own so that a cold parse of a line
   * without such an option doesn't compile it.
   */
  private noteRules(option: Option): void {
    const needs: (Option | null)[] = [];
    const excludes: (Option | null)[] = [];
    for (const name of option.dependsOn ?? []) {
      needs.push(this.scope.resolve(name));
    }
    for (const name of option.exclusiveOn ?? []) {
      excludes.push(this.scope.resolve(name));
    }
    (this.rules ??= []).push({ option, needs, excludes });
  }

  /**
   * Count a use of the repeatable `option`, and return the values its uses
   * share. It's a method of its own so that a cold parse of a line without a
   * repeatable option doesn't compile it.
   */
  private repeatUse(option: Option): string[] {
    const key = optionKey(option);
    const repeatedUses = (this.repeatedUses ??= new Map());
    let uses = repeatedUses.get(key);
    if (!uses) {
      uses = { values: [], count: 0 };
      repeatedUses.set(key, uses);
    }
    if (uses.count >= repeatLimit(option)) {
      this.fail("Too many repetitions");
    }
    uses.count += 1;
    return uses.values;
  }

  /**
   * Add the value attached to the open option's token after `separator`,
   * starting at `start`. It's the option's only value, so no later token can
   * be one. Returns where the value starts, or null if the option doesn't
   * accept it.
   */
  private addAttachedValue(
    token: string,
    start: number,
    separator: string,
  ): { option: Option; start: number } | null {
    const open = this.open;
    const option = open.option!;
    const name = open.name;
    open.count += 1;
    open.min = open.separateMax = 0;
    if (!this.values) {
      this.fail(takesNoArguments(name));
      return null;
    }
    const problem = this.scope.separatorProblem(option, name, separator);
    if (problem) {
      this.fail(problem);
    }
    this.values.push(token.slice(start));
    return problem === null ? { option, start } : null;
  }

  private addArg(value: string): TokenReading {
    this.endOption();
    if (this.args.length >= this.scope.argsLimit) {
      this.failArgs(tooManyArguments(value));
    }
    this.args.push(value);
    return argumentReading;
  }

  /** Read `--`. Every token after it is an argument. */
  private argSeparator(): TokenReading {
    this.endOption();
    this.open = noOpenOption;
    this.optionsAllowed = false;
    // A command that requires a subcommand allows `--` alone, and reports
    // any argument after it.
    const command = this.scope.command;
    if (this.args.length >= this.scope.argsLimit && !command.requiresSubcommand) {
      this.failArgs("Unexpected argument '--', did you mean to use an option instead?");
    }
    this.argSeparatorIndex = this.args.length;
    return separatorReading;
  }

  /**
   * How the next token can name a subcommand, its own or an inherited one, or
   * null if it can't. It can't once an argument is found, or while the open
   * option needs the next token as its value. A required or variadic option
   * value takes priority over a subcommand. A short optional value could be a
   * prefix of a subcommand's name, so only an exact name can end an option
   * that still has room.
   */
  private get subcommandMatching(): SubcommandMatching | null {
    if (this.hasFoundArg || !this.scope.hasSubcommands) {
      return null;
    }
    const open = this.open;
    const hasRoom = open.count < open.separateMax;
    if (open.count < open.min || (hasRoom && open.separateMax === Infinity)) {
      return null;
    }
    return hasRoom ? exactName : anyName;
  }

  /**
   * Throw everything that's wrong with the finished command line, then run
   * each argument's parser. Returns what the line was parsed as, or a promise
   * of it if one of them gave a promise. Only call this when there's no {@link problem}.
   *
   * The checks here don't depend on each other, so every one that fails is
   * reported, with each value its parser rejected.
   */
  finish(): ParseResult | Promise<ParseResult> {
    // An option with an action, like --help, works however the rest of the
    // command line is wrong, as long as every token could be read. So does the
    // usage a command shows when no subcommand is named.
    const command = this.scope.command;
    const showsUsage = command.requiresSubcommand && !command.action && this.args.length === 0;
    const skipsChecks = this.optionAction !== undefined || showsUsage;
    let problems: ParseError[] | null = null;
    const extra = this.unmatched ?? this.tooManyArgs;
    if (!skipsChecks && extra) {
      problems = [extra];
    }
    if (!skipsChecks && this.args.length < this.scope.argsMin) {
      (problems ??= []).push(
        new ParseError(this.ctx(), tooFewArguments(this.scope.argsMin, this.scope.argsMax)),
      );
    }
    this.endOption();
    if (this.problem) {
      (problems ??= []).push(this.problem);
    }
    if (!skipsChecks) {
      if (this.rules) {
        problems = checkOptionRules(this.rules, this.seenOptions, this.scope.path, problems);
      }
      if (this.scope.hasRequiredOption) {
        problems = checkRequiredOptions(this.options, this.scope, this.scope.path, problems);
      }
    }
    // Defaults are added after the checks, so they never count as typed.
    const given = this.args.length;
    if (!command.requiresSubcommand) {
      addDefaults(this.args, command.args, given);
    }
    // No argument's parser runs for an option action, which reads what was typed.
    if (!skipsChecks && (this.uses || this.scope.hasParse || hasParse(command.args))) {
      return this.parsed(problems, given);
    }
    if (problems) {
      throw problemsError(problems);
    }
    return this.result(null);
  }

  /**
   * {@link finish}, for a command line with an argument's parser to run. It's a method
   * of its own so that a cold parse without one doesn't compile it.
   */
  private async parsed(problems: ParseError[] | null, typedArgs: number): Promise<ParseResult> {
    // The defaults of an option that wasn't used go through its parser too,
    // since an action can read them.
    const unused: Option[] = [];
    if (this.scope.hasParse) {
      const used = usedKeys(this.seenOptions);
      const { local, persistent } = this.scope;
      for (let i = 0; i < local.length + persistent.length; i++) {
        const option = i < local.length ? local[i] : persistent[i - local.length];
        if (hasParse(option.args) && !used.has(optionKey(option))) {
          unused.push(option);
        }
      }
    }
    const defaults = await parseValues({
      context: this.ctx(),
      problems,
      args: this.args,
      typedArgs,
      argSpecs: this.scope.command.args,
      uses: this.uses,
      unused,
    });
    return this.result(defaults);
  }

  private result(defaults: Map<Option, unknown[]> | null): ParseResult {
    return {
      path: this.scope.path,
      action: this.optionAction ?? this.scope.command.action ?? usage,
      args: this.args,
      argSeparatorIndex: this.argSeparatorIndex,
      options: optionArgs(this.options, this.scope, defaults),
    };
  }

  /** Whether using `option` next would go over its repeat limit or break an `exclusiveOn` rule. */
  private conflicts(option: Option, used: ReadonlySet<string>): boolean {
    const key = optionKey(option);
    if ((this.repeatedUses?.get(key)?.count ?? 0) >= repeatLimit(option)) {
      return true;
    }
    // An option it excludes was used, or an option used excludes it.
    for (const name of option.exclusiveOn ?? []) {
      const excluded = this.scope.resolve(name);
      if (excluded && used.has(optionKey(excluded))) {
        return true;
      }
    }
    for (const { excludes } of this.rules ?? []) {
      if (excludes.some((excluded) => excluded !== null && optionKey(excluded) === key)) {
        return true;
      }
    }
    return false;
  }

  /** The options the next token can use. See {@link NextToken.options}. */
  private usableOptions(): UsableOption[] {
    const used = usedKeys(this.seenOptions);
    const { local, persistent } = this.scope.live(this.subcommandMatching);
    const usable: UsableOption[] = [];
    for (const { option, forms } of [...local, ...persistent]) {
      if (this.conflicts(option, used)) {
        continue;
      }
      usable.push({ option, forms, used: used.has(optionKey(option)) });
    }
    return usable;
  }

  /**
   * What the next token can be. See {@link readNext}. Reading more tokens
   * doesn't change what this returns.
   */
  next(): Omit<NextToken, "attached" | "partialIsOption"> {
    const { count, min, separateMax } = this.open;
    const open = count < separateMax ? this.open.option : null;
    const command = this.scope.command;
    // Every token after `--` is an argument.
    const afterSeparator = this.argSeparatorIndex !== -1;
    // The token is read on this scanner after this, which can add a value to
    // an option's values and move the scope into a subcommand.
    const options = new Map<string, unknown[]>();
    for (const [name, values] of this.options) {
      options.set(name, [...values]);
    }
    const path: CommandPath = [...this.scope.path];
    return {
      line: {
        path,
        args: [...this.args],
        argSeparatorIndex: this.argSeparatorIndex,
        // The spec's types say what each value is. Here every value is a string.
        options: optionArgs(options, CommandScope.at(path), null) as OptionArgs,
      },
      directives: { ...this.directives },
      optionsAllowed: this.optionsAllowed,
      subcommands: !afterSeparator && this.subcommandMatching ? this.scope.subcommands() : [],
      options: this.optionsAllowed ? this.usableOptions() : [],
      value: open && {
        option: open,
        arg: argAt(open.args, count),
        required: count < min,
      },
      arg: open ? undefined : argAt(command.args, this.args.length),
    };
  }

  /**
   * Read `token`, and say what it was read as. A subcommand it names is
   * loaded unless `load` is false; {@link settle} before the next token.
   */
  read(token: string, load = true): TokenReading {
    // Every token after `--` is an argument.
    if (this.argSeparatorIndex !== -1) {
      return this.addArg(token);
    }
    // "--" disables option & subcommand parsing, so it's checked first.
    // Once options must stop, it's an argument like any other token.
    if (token === "--" && this.optionsAllowed) {
      return this.argSeparator();
    }

    const subcommands = this.subcommandMatching;
    const meaning = this.scope.meaning(token, subcommands, this.optionsAllowed);
    if (meaning?.kind === "subcommand") {
      this.endOption();
      this.open = noOpenOption;
      this.pending = this.scope.enter(meaning.command, load);
      return meaning;
    }

    // Whether the open option can take this token as a value.
    const open = this.open;
    const hasRoom = open.count < open.separateMax;

    // A token written like an option is one, unless its first name refers to
    // no option and the open option has room. Then it's a value, like `-5`.
    if (meaning && (meaning.uses[0].option || !hasRoom)) {
      const used: Option[] = [];
      const uses = meaning.uses;
      for (let i = 0; i < uses.length; i++) {
        const { option, name } = uses[i];
        if (option) {
          this.useOption(option, name);
          used.push(option);
        } else {
          this.unknownOption(name);
        }
      }
      if (used.length === 0) {
        return unknownReading;
      }
      const value = meaning.attached;
      const attached = value && this.addAttachedValue(token, value.start, value.separator);
      return { kind: "options", options: used, attached };
    }

    // The token isn't `--`, a subcommand or an option. It's a value of the
    // open option if that has room. Only an option that takes separate tokens
    // has room, so the value needs no separator check.
    if (hasRoom) {
      open.count += 1;
      this.values!.push(token);
      return { kind: "value", option: open.option! };
    }

    // Otherwise it's an argument, which stops later tokens from being
    // subcommands. Where a subcommand could be, a token the command has no
    // room for is a subcommand that didn't match.
    if (subcommands && this.args.length >= this.scope.argsLimit) {
      this.failUnmatched(token, subcommands.exactOnly);
    }
    this.hasFoundArg = true;
    // No subcommand follows an argument, so the directives can't change after this.
    if (this.directives.optionsMustPrecedeArguments) {
      this.optionsAllowed = false;
    }
    return this.addArg(token);
  }

  /**
   * Keep why `token` names no subcommand, if it's the first and the current
   * command has subcommands of its own or requires one.
   */
  private failUnmatched(token: string, exactOnly: boolean): void {
    const command = this.scope.command;
    if (!this.unmatched && (command.subcommands?.length || command.requiresSubcommand)) {
      const { message, didYouMean } = this.scope.unmatched(token, exactOnly);
      this.unmatched = new ParseError(this.ctx(), message, didYouMean);
    }
  }

  /**
   * See {@link readHelpNames}. Call it on a new scanner for the root of
   * `path`.
   */
  async readHelpNames(path: CommandPath, names: readonly string[]): Promise<HelpNames> {
    const [, ...below] = path;
    const help = below[below.length - 1];
    for (let i = 0; i < below.length - 1; i++) {
      // The parser entered these on the way to help, so they're loaded.
      this.scope.enterNow(below[i]);
    }
    // The parser read the names as arguments of help, so none is an option.
    this.optionsAllowed = false;
    for (let i = 0; i < names.length; i++) {
      const own = this.scope.command.subcommands;
      const reading = this.read(names[i]);
      if (reading.kind !== "subcommand") {
        // Where the command has no subcommands of its own, the parser reports
        // a name it has no room for as too many arguments. Help prints the
        // command's help instead.
        return { path: this.scope.path, error: this.unmatched, subcommands: [] };
      }
      // With a persistent help command, `cli help a help` is `cli a help`.
      if (reading.command === help && !own?.includes(help)) {
        const [root, ...entered] = this.scope.path;
        return { path: [root, ...entered.slice(0, -1)], error: null, subcommands: [] };
      }
      if (this.pending) {
        await this.settle();
      }
    }
    const subcommands = this.scope.subcommands();
    if (this.scope.command.subcommands?.includes(help)) {
      return { path: this.scope.path, error: null, subcommands };
    }
    // An inherited copy of help ends the names, so it leads nowhere new.
    const next: LiveSubcommand[] = [];
    for (let i = 0; i < subcommands.length; i++) {
      if (subcommands[i].command !== help) {
        next.push(subcommands[i]);
      }
    }
    return { path: this.scope.path, error: null, subcommands: next };
  }
}

/**
 * Start reading a command line for `spec`, to say what each token is read as
 * in turn. Reads leniently, like {@link readNext}.
 */
export function tokenReader(spec: Spec): TokenReader {
  const s = new Scanner(spec);
  return {
    async read(token) {
      await s.settle();
      return s.read(token);
    },
  };
}

/**
 * Work out what the token after `before` can be, and how the parser reads
 * `partial`: whether it's an option, and if so, whether it has a value
 * attached. Reads leniently, so a line that's wrong at the moment still has
 * an answer. Completion is built on this.
 */
export async function readNext(spec: Spec, before: readonly string[], partial: string): Promise<NextToken> {
  const s = new Scanner(spec);
  await s.readAll(before, false);
  const next = s.next();
  let attached: NextToken["attached"] = null;
  let partialIsOption = false;
  if (partial !== "" && next.optionsAllowed) {
    // Nothing follows the partial token, so a command it names isn't loaded.
    const reading = s.read(partial, false);
    partialIsOption =
      reading.kind === "options" || reading.kind === "unknown" || reading.kind === "separator";
    const found = reading.kind === "options" ? reading.attached : null;
    const arg = found && argAt(found.option.args, 0);
    if (found && arg) {
      attached = {
        option: found.option,
        arg,
        prefix: partial.slice(0, found.start),
        value: partial.slice(found.start),
      };
    }
  }
  return { ...next, attached, partialIsOption };
}

/**
 * Say what the parser reads `token` as when it comes after `before`. Reads
 * leniently, like {@link readNext}. To read every token of a line, use
 * {@link tokenReader}, which this is built on.
 */
export async function readToken(spec: Spec, before: readonly string[], token: string): Promise<TokenReading> {
  const reader = tokenReader(spec);
  for (const earlier of before) {
    await reader.read(earlier);
  }
  return reader.read(token);
}

/**
 * Read `names`, the arguments of the help command that ends `path`, the way
 * the parser reads them in place of `help`. The names end at the first one
 * the parser doesn't read as a subcommand. That name is an error where the
 * parser reports it as an unknown or ambiguous command. Otherwise help ignores
 * it and the names after it, so `cli help completion zsh` prints the help of
 * `completion`.
 */
export function readHelpNames(path: CommandPath, names: readonly string[]): Promise<HelpNames> {
  return new Scanner(path[0]).readHelpNames(path, names);
}

/**
 * Parse the input tokens using the given CLI spec.
 *
 * This resolves to a `ParseResult`, which contains the array of subcommands
 * used, the provided options, the arguments, and the action to run. If
 * parsing fails, the promise rejects.
 */
export async function parse(input: readonly string[], spec: Spec): Promise<ParseResult> {
  const s = new Scanner(spec);
  await s.readAll(input, true);
  return s.finish();
}
