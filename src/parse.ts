import type { Action, Arg, CommandPath, Option, OptionArgs, Spec, Subcommand, SuggestInit } from "./types.js";
import { addDefaults, argAt, hasParse, maxArgs, minArgs, unusedDefaults } from "./args.js";
import { asArray } from "./util.js";
import {
  excludesOption,
  missingOption,
  ParseError,
  problemsError,
  requiresOption,
  separatorAfterArguments,
  takesNoArguments,
  tooFewArguments,
  tooFewOptionArguments,
  tooManyArguments,
  tooManyRepetitions,
  unknownOption,
} from "./errors.js";
import type { ErrorContext } from "./errors.js";
import { anyName, CommandScope, exactName, optionKey } from "./scope.js";
import type { Directives, LiveSubcommand, OptionForm, SubcommandMatching } from "./scope.js";
import { parseValues } from "./values.js";
import type { Given } from "./values.js";

export interface ParseResult {
  /** The positional arguments: each one a string, or what its parser gave. */
  args: unknown[];
  argSeparatorIndex: number;
  /** The options used, as the action receives them. */
  options: OptionArgs<unknown>;
  path: CommandPath;
  /**
   * The action to run: the last option action used, or else the selected
   * command's action. Undefined for a command without an action, which
   * prints its help.
   */
  action: Action | undefined;
}

/**
 * What the token after a command line can be, as the parser would read it.
 * The lists are functions, worked out the first time they're called, so a
 * completion that doesn't need one doesn't pay for it.
 */
export interface NextToken {
  /** What the line before the token gives a suggester. */
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
  subcommands(): readonly LiveSubcommand[];
  /**
   * The options the token can use, hidden ones included, local options first.
   * Empty when the token can't be an option.
   */
  options(): readonly UsableOption[];
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

/**
 * A token of the command line: a word as the parser reads it. A token says
 * what the word was read as, and a problem says what's wrong with it. See
 * {@link tokenReader}.
 */
export type Token =
  | { kind: "subcommand"; command: Subcommand }
  /**
   * One option, or several chained short options, in the order used, each
   * with the option its name refers to, or null if none does.
   */
  | {
      kind: "options";
      uses: readonly { readonly option: Option | null; readonly name: string }[];
      /**
       * The value the word has after its last use, valid or not: where it
       * starts, the separator before it, which is "" if there's none, and the
       * argument it's for, which is undefined if the option takes none.
       */
      attached: { start: number; separator: string; arg: Arg | undefined } | null;
    }
  /** `--`, the end of options. */
  | { kind: "separator" }
  /** A value of the option before it, for `arg`. */
  | { kind: "value"; option: Option; arg: Arg | undefined }
  /** A positional argument of the command, for `arg`, or for none if the command has no room for it. */
  | { kind: "argument"; arg: Arg | undefined };

// `--` is the same token every time, made once and shared.
const separatorToken: Token = Object.freeze({ kind: "separator" });

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
  readonly option: Option;
  readonly name: string;
  count: number;
  min: number;
  separateMax: number;
  /** The index of the option's token. */
  readonly token: number;
  /** Where a value attached to the option's token starts, or -1. */
  attachedStart: number;
  /**
   * The option's values, attached ones included, until it ends and they're
   * checked against its arguments. Null for an option that takes none, or
   * once it has ended. A repeatable option keeps adding to the same array,
   * so this use's values start at `start`.
   */
  values: string[] | null;
  readonly start: number;
}

/**
 * The state when no option is open. It has no room for a value, so nothing
 * reads its option. It's frozen because every scanner shares it.
 */
const noOpenOption: OpenOption = Object.freeze({
  option: Object.freeze({ name: "" }),
  name: "",
  count: 0,
  min: 0,
  separateMax: 0,
  token: -1,
  attachedStart: -1,
  values: null,
  start: 0,
});

/**
 * The context of an error at the end of `path`, with a copy of the path, in
 * the token at index `token`. See {@link ErrorContext}.
 */
function contextAt(path: CommandPath, token?: number, start?: number): ErrorContext {
  return { path: [...path], token, start };
}

/** A name in a `dependsOn` or `exclusiveOn` rule, and the option it refers to, or null if none. */
interface RuleName {
  name: string;
  option: Option | null;
}

/**
 * An option used that has a `dependsOn` or `exclusiveOn` rule, with the option
 * each name in the rule refers to at the command the option was first used in.
 * A name means what it means to the option's own command, so a parent's option
 * that isn't persistent is out of a subcommand's reach, and a name a
 * subcommand's option has taken still means the parent's option to the
 * parent's.
 */
interface UsedRules {
  option: Option;
  /** The index of the token the option was first used in. */
  token: number;
  needs: readonly RuleName[];
  excludes: readonly RuleName[];
}

/** Whether `name` refers to `option`, or to an option with the same names. */
function refersTo(name: RuleName, option: Option): boolean {
  return name.option !== null && optionKey(name.option) === optionKey(option);
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
 * `problems`, and return it. `path` ends at the current command. Every
 * missing option comes first, then every pair that can't be used together.
 */
function checkOptionRules(
  rules: readonly UsedRules[],
  seenOptions: readonly Option[],
  path: CommandPath,
  problems: ParseError[] | null,
): ParseError[] | null {
  const used = usedKeys(seenOptions);
  const isUsed = (name: RuleName): name is { name: string; option: Option } =>
    name.option !== null && used.has(optionKey(name.option));
  for (const { option, token, needs } of rules) {
    for (const need of needs) {
      if (!isUsed(need)) {
        (problems ??= []).push(new ParseError(contextAt(path, token), requiresOption(option, need.name)));
      }
    }
  }
  for (let i = 0; i < rules.length; i++) {
    const { option, token, excludes } = rules[i];
    for (const excluded of excludes) {
      if (isUsed(excluded) && !excludedBefore(rules, i, excluded.option)) {
        (problems ??= []).push(new ParseError(contextAt(path, token), excludesOption(option, excluded.name)));
      }
    }
  }
  return problems;
}

/**
 * Whether `excluded` was used before the option of `rules[i]` and excludes it
 * too. Two options that exclude each other are one problem, which the first
 * of them reports.
 */
function excludedBefore(rules: readonly UsedRules[], i: number, excluded: Option): boolean {
  const { option } = rules[i];
  for (let k = 0; k < i; k++) {
    const earlier = rules[k];
    if (
      optionKey(earlier.option) === optionKey(excluded) &&
      earlier.excludes.some((name) => refersTo(name, option))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Add each option that `scope` requires and that's missing to `problems`,
 * and return it. `path` ends at the command `scope` is for, and `entered` has
 * the index of the token that named each command on it. A missing option is
 * a problem with the command that defines it.
 */
function checkRequiredOptions(
  options: ReadonlyMap<string, unknown[]>,
  scope: CommandScope,
  path: CommandPath,
  entered: readonly number[],
  problems: ParseError[] | null,
): ParseError[] | null {
  // Checking local options first reports a missing local option before a
  // missing persistent one.
  for (const option of scope.local.concat(scope.persistent)) {
    if (!option.isRequired) {
      continue;
    }
    let missing: string | undefined;
    for (const name of asArray(option.name)) {
      if (!options.has(name)) {
        missing = name;
        break;
      }
    }
    if (missing !== undefined) {
      const definedAt = option.isPersistent ? definerIndex(path, option) : path.length - 1;
      (problems ??= []).push(new ParseError(contextAt(path, entered[definedAt]), missingOption(missing)));
    }
  }
  return problems;
}

/** The index in `path` of the command that defines the persistent `option`. */
function definerIndex(path: CommandPath, option: Option): number {
  for (let i = path.length - 2; i >= 0; i--) {
    if (asArray(path[i].options).includes(option)) {
      return i;
    }
  }
  return path.length - 1;
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
    // use, so its values count the uses. One used without values counts once.
    count: (name) => {
      const values = options.get(name);
      return values === undefined ? 0 : Math.max(values.length, 1);
    },
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

/** Where names read as subcommands lead. See {@link readNames}. */
export interface NamesRead {
  /** The commands from the root to the last one the names entered. */
  path: CommandPath;
  /** The error the parser reports if a name is an unknown or ambiguous command. */
  error: ParseError | null;
  /**
   * The subcommands the next name can lead to, hidden ones included, each
   * with the names that still refer to it. Empty once the names have ended.
   */
  subcommands: readonly LiveSubcommand[];
}

/** Reads a command line one word at a time. See {@link tokenReader}. */
export interface TokenReader {
  /**
   * Read the next word of the line, and resolve to the token it is, once the
   * command the word before it entered has loaded.
   */
  read(word: string): Promise<Token>;
  /** The token {@link read} would read `word` as, without reading it. */
  peek(word: string): Promise<Token>;
  /**
   * End the line, and resolve to what it was parsed as, like {@link parse}.
   * Rejects with what {@link parse} would throw for the tokens read.
   */
  finish(): Promise<ParseResult>;
}

/**
 * The state of reading one command line, one token at a time. The scope says
 * what each token means at the current command, and this is the only code
 * that decides what the token is read as and keeps what that changes. A
 * read never throws: it skips whatever is invalid and keeps going, so
 * {@link readNext} can still read a line that's wrong at the moment. A
 * scanner that reports keeps the first problem it finds for {@link parse} to
 * throw.
 */
class Scanner {
  // The last option action used.
  private optionAction: Action | undefined = undefined;
  private readonly args: string[] = [];
  // The index of the token each argument came from.
  private readonly argTokens: number[] = [];
  // The index of the token being read, and of the token that named each
  // command on the path, -1 for the program's name.
  private at = -1;
  private readonly entered: number[] = [-1];
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

  // The first token that can't be read the way it's written, like an unknown
  // option or a value an option doesn't take. `parse` stops there.
  problem: ParseError | null = null;

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
  private uses: Given[] | null = null;

  // The uses of each repeatable option, keyed by `optionKey`, or null until
  // one is used. A subcommand's copy of a parent's option has the same names,
  // so it continues the parent's uses. An option with other names, even a
  // subset, has uses of its own.
  private repeatedUses: Map<string, RepeatedUses> | null = null;

  /**
   * Whether the scanner keeps the line's problems, to report them. A read that
   * only asks what each token is, like completion's, doesn't describe them.
   */
  private readonly reports: boolean;

  constructor(spec: Spec, reports: boolean) {
    this.scope = new CommandScope(spec);
    this.directives = this.scope.directives;
    this.reports = reports;
  }

  /**
   * Read each of `tokens` in turn, waiting after each one for the command it
   * entered to load. A scanner that reports throws the first problem as soon
   * as it's found.
   */
  async readAll(tokens: readonly string[]): Promise<void> {
    for (let i = 0; i < tokens.length; i++) {
      this.read(tokens[i]);
      if (this.problem) {
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
  private ctx(token = this.at, start?: number): ErrorContext {
    return contextAt(this.scope.path, token, start);
  }

  /**
   * Keep the problem `message` describes if it's the first and the scanner
   * reports. It's in the token being read unless `token` says otherwise.
   */
  private fail(message: string, token = this.at, start?: number): void {
    if (this.reports) {
      this.problem ??= new ParseError(this.ctx(token, start), message);
    }
  }

  /** Keep the first argument the command has no room for, like {@link fail}. */
  private failArgs(message: string): void {
    if (this.reports) {
      this.tooManyArgs ??= new ParseError(this.ctx(), message);
    }
  }

  private unknownOption(option: string): void {
    if (this.reports) {
      this.problem ??= unknownOption(option, this.scope.suggestionNames(), this.ctx());
    }
  }

  // Every token except an option's value, or an unknown option, ends the
  // previous option. Then the defaults of the optional arguments that weren't
  // given are added, so a bare `--inspect` gets its port.
  private endOption(): void {
    const open = this.open;
    const values = open.values;
    if (values) {
      open.values = null;
      const args = open.option.args;
      const typedEnd = values.length;
      const given = typedEnd - open.start;
      if (given < minArgs(args)) {
        this.failTooFewValues();
      } else {
        addDefaults(values, args, given);
      }
      if (hasParse(args)) {
        this.noteUse(values, typedEnd);
      }
    }
  }

  /**
   * Keep the values the open option just finished taking, for its parser.
   * It's a method of its own so that a cold parse of a line without such an
   * option doesn't compile it.
   */
  private noteUse(values: string[], typedEnd: number): void {
    const { option, name, attachedStart, token, start } = this.open;
    // A value attached to the option is in its token, and the rest each
    // follow in a token of their own.
    const first = attachedStart === -1 ? token + 1 : token;
    const tokens: number[] = [];
    for (let i = start; i < typedEnd; i++) {
      tokens.push(first + i - start);
    }
    (this.uses ??= []).push({
      args: option.args,
      option: name,
      values,
      start,
      typedEnd,
      end: values.length,
      tokens,
      tokenStart: attachedStart === -1 ? undefined : attachedStart,
    });
  }

  /**
   * Keep the problem of an open option given too few values, like
   * {@link fail}. It's a method of its own so that a cold parse where every
   * option gets its values doesn't compile it.
   */
  private failTooFewValues(): void {
    const { name, option, token } = this.open;
    this.fail(tooFewOptionArguments(name, minArgs(option.args), maxArgs(option.args)), token);
  }

  private useOption(option: Option, name: string): void {
    this.endOption();
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
    const max = maxArgs(option.args);
    this.open = {
      option,
      name,
      count: 0,
      min: minArgs(option.args),
      // Options that require a separator only take attached values.
      separateMax: option.requiresSeparator ? 0 : max,
      token: this.at,
      attachedStart: -1,
      values: max > 0 ? optionValues : null,
      start: optionValues.length,
    };
    // Each use of a repeatable option without arguments adds an empty string,
    // so its values count the uses.
    if (option.isRepeatable && !option.args) {
      optionValues.push("");
    }
  }

  /**
   * Keep what the rules of `option` refer to at the current command, where it
   * was just used. It's a method of its own so that a cold parse of a line
   * without such an option doesn't compile it.
   */
  private noteRules(option: Option): void {
    // An option's rules are the same however often it's used.
    if (this.rules?.some((rule) => optionKey(rule.option) === optionKey(option))) {
      return;
    }
    const needs = this.ruleNames(option.dependsOn);
    const excludes = this.ruleNames(option.exclusiveOn);
    (this.rules ??= []).push({ option, token: this.at, needs, excludes });
  }

  /** Each of `names` with the option it refers to here, leaving out a second name of the same option. */
  private ruleNames(names: readonly string[] | undefined): RuleName[] {
    const found: RuleName[] = [];
    for (const name of names ?? []) {
      const option = this.scope.resolve(name);
      if (option === null || !found.some((other) => refersTo(other, option))) {
        found.push({ name, option });
      }
    }
    return found;
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
      this.fail(tooManyRepetitions);
    }
    uses.count += 1;
    return uses.values;
  }

  /**
   * Add the value attached to the open option's token after `separator`,
   * starting at `start`. It's the option's only value, so no later token can
   * be one. The option accepts it if it takes values and `separator` is one
   * it can be written with. Otherwise the value is kept as a problem.
   */
  private addAttachedValue(token: string, start: number, separator: string): void {
    const open = this.open;
    const name = open.name;
    open.count += 1;
    open.min = open.separateMax = 0;
    open.attachedStart = start;
    if (!open.values) {
      this.fail(takesNoArguments(name), this.at, start);
      return;
    }
    const problem = this.scope.separatorProblem(open.option, name, separator);
    if (problem) {
      this.fail(problem);
    }
    open.values.push(token.slice(start));
  }

  /** Read `--`. Every token after it is an argument. */
  private argSeparator(): void {
    this.endOption();
    this.open = noOpenOption;
    this.optionsAllowed = false;
    // A command that requires a subcommand allows `--` alone, and reports
    // any argument after it.
    const command = this.scope.command;
    if (this.args.length >= this.scope.argsLimit && !command.requiresSubcommand) {
      this.failArgs(separatorAfterArguments);
    }
    this.argSeparatorIndex = this.args.length;
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
        new ParseError(
          this.ctx(this.entered[this.entered.length - 1]),
          tooFewArguments(this.scope.argsMin, this.scope.argsMax),
        ),
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
        problems = checkRequiredOptions(this.options, this.scope, this.scope.path, this.entered, problems);
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
      for (const option of this.scope.local.concat(this.scope.persistent)) {
        if (hasParse(option.args) && !used.has(optionKey(option))) {
          unused.push(option);
        }
      }
    }
    const args: Given = {
      args: this.scope.command.args,
      option: null,
      values: this.args,
      start: 0,
      typedEnd: typedArgs,
      end: this.args.length,
      tokens: this.argTokens,
    };
    const given = this.uses ? [args, ...this.uses] : [args];
    const defaults = await parseValues({ context: this.ctx(), problems, given, unused });
    return this.result(defaults);
  }

  private result(defaults: Map<Option, unknown[]> | null): ParseResult {
    return {
      path: this.scope.path,
      action: this.optionAction ?? this.scope.command.action,
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
      if (excludes.some((name) => refersTo(name, option))) {
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
    for (const { option, forms } of local.concat(persistent)) {
      if (this.conflicts(option, used)) {
        continue;
      }
      usable.push({ option, forms, used: used.has(optionKey(option)) });
    }
    return usable;
  }

  /**
   * What the next token can be, where `partial` is that token as typed so
   * far. See {@link readNext}. It reads nothing, so the lists it gives are
   * worked out from the line as it stands when they're asked for.
   */
  next(partial: string): NextToken {
    const { count, min, separateMax } = this.open;
    const open = count < separateMax ? this.open.option : null;
    const command = this.scope.command;
    let attached: NextToken["attached"] = null;
    let partialIsOption = false;
    if (partial !== "" && this.optionsAllowed) {
      const token = this.peek(partial);
      partialIsOption = token.kind === "options" || token.kind === "separator";
      if (token.kind === "options" && token.attached) {
        // Completion offers values only for a value the option accepts there.
        const { start, separator, arg } = token.attached;
        const { option, name } = token.uses[token.uses.length - 1];
        if (option && arg && this.scope.separatorProblem(option, name, separator) === null) {
          attached = { option, arg, prefix: partial.slice(0, start), value: partial.slice(start) };
        }
      }
    }
    let subcommands: readonly LiveSubcommand[] | undefined;
    let options: readonly UsableOption[] | undefined;
    return {
      line: {
        path: this.scope.path,
        args: this.args,
        argSeparatorIndex: this.argSeparatorIndex,
        // The spec's types say what each value is. Here every value is a string.
        options: optionArgs(this.options, this.scope, null) as OptionArgs,
      },
      directives: this.directives,
      optionsAllowed: this.optionsAllowed,
      // Every token after `--` is an argument.
      subcommands: () =>
        (subcommands ??=
          this.argSeparatorIndex === -1 && this.subcommandMatching ? this.scope.subcommands() : []),
      options: () => (options ??= this.optionsAllowed ? this.usableOptions() : []),
      value: open && {
        option: open,
        arg: argAt(open.args, count),
        required: count < min,
      },
      arg: open ? undefined : argAt(command.args, this.args.length),
      attached,
      partialIsOption,
    };
  }

  /**
   * The token `word` is, read next: `--`, a subcommand, options, a value of
   * the open option, or an argument. It changes nothing, so a peek and a
   * {@link read} decide the same way.
   */
  peek(word: string): Token {
    // Every word after `--` is an argument.
    if (this.argSeparatorIndex !== -1) {
      return this.argument();
    }
    // "--" disables option & subcommand parsing, so it's checked first.
    // Once options must stop, it's an argument like any other word.
    if (word === "--" && this.optionsAllowed) {
      return separatorToken;
    }
    const token = this.scope.token(word, this.subcommandMatching, this.optionsAllowed);
    // Whether the open option can take this word as a value.
    const open = this.open;
    const hasRoom = open.count < open.separateMax;
    // A word written like an option is one, unless its first name refers to
    // no option and the open option has room. Then it's a value, like `-5`.
    if (token && (token.kind === "subcommand" || token.uses[0].option || !hasRoom)) {
      return token;
    }
    // The word isn't `--`, a subcommand or an option. It's a value of the
    // open option if that has room. Only an option that takes separate words
    // has room, so the value needs no separator check.
    return hasRoom
      ? { kind: "value", option: open.option, arg: argAt(open.option.args, open.count) }
      : this.argument();
  }

  /** The token of an argument read next. */
  private argument(): Token {
    return { kind: "argument", arg: argAt(this.scope.command.args, this.args.length) };
  }

  /**
   * Read `word`, and return the token it is. A subcommand it names is loaded;
   * {@link settle} before the next word.
   */
  read(word: string): Token {
    this.at++;
    const token = this.peek(word);
    const kind = token.kind;
    if (kind === "value") {
      this.open.count += 1;
      this.open.values!.push(word);
    } else if (kind === "subcommand") {
      this.endOption();
      this.open = noOpenOption;
      this.entered.push(this.at);
      this.pending = this.scope.enter(token.command);
    } else if (kind === "options") {
      const uses = token.uses;
      for (let i = 0; i < uses.length; i++) {
        const { option, name } = uses[i];
        if (option) {
          this.useOption(option, name);
        } else {
          this.unknownOption(name);
        }
      }
      // Only a known option, the last one used, has a value attached.
      const value = token.attached;
      if (value !== null) {
        this.addAttachedValue(word, value.start, value.separator);
      }
    } else if (kind === "separator") {
      this.argSeparator();
    } else {
      this.readArgument(word);
    }
    return token;
  }

  /** Read `token` as an argument. */
  private readArgument(token: string): void {
    if (this.argSeparatorIndex === -1) {
      // An argument before `--` stops later tokens from being subcommands.
      // Where a subcommand could be, a token the command has no room for is
      // a subcommand that didn't match.
      const subcommands = this.subcommandMatching;
      if (subcommands && this.args.length >= this.scope.argsLimit) {
        this.failUnmatched(token, subcommands.exactOnly);
      }
      this.hasFoundArg = true;
      // No subcommand follows an argument, so the directives can't change after this.
      if (this.directives.optionsMustPrecedeArguments) {
        this.optionsAllowed = false;
      }
    }
    this.endOption();
    if (this.args.length >= this.scope.argsLimit) {
      this.failArgs(tooManyArguments(token));
    }
    this.args.push(token);
    this.argTokens.push(this.at);
  }

  /**
   * Keep why `token` names no subcommand, if it's the first, the scanner
   * reports, and the current command has subcommands of its own or requires
   * one.
   */
  private failUnmatched(token: string, exactOnly: boolean): void {
    const command = this.scope.command;
    if (this.reports && !this.unmatched && (command.subcommands?.length || command.requiresSubcommand)) {
      const { message, didYouMean } = this.scope.unmatched(token, exactOnly);
      this.unmatched = new ParseError(this.ctx(), message, didYouMean);
    }
  }

  /**
   * See {@link readNames}. Call it on a new scanner for the root of `path`.
   */
  async readNames(path: CommandPath, names: readonly string[]): Promise<NamesRead> {
    for (let i = 1; i < path.length; i++) {
      // The parser entered these on the way here, so they're loaded.
      this.scope.enterNow(path[i]);
    }
    // The names are arguments of the command they follow, so none is an option.
    this.optionsAllowed = false;
    for (let i = 0; i < names.length; i++) {
      if (this.read(names[i]).kind !== "subcommand") {
        // Where the command has no subcommands of its own, the parser reports
        // a name it has no room for as too many arguments. Reading just ends.
        return { path: this.scope.path, error: this.unmatched, subcommands: [] };
      }
      if (this.pending) {
        await this.settle();
      }
    }
    return { path: this.scope.path, error: null, subcommands: this.scope.subcommands() };
  }
}

/**
 * Start reading a command line for `spec`, to say what each token is read as
 * in turn. A token that's wrong doesn't stop it: it keeps reading, the way
 * {@link readNext} does, and {@link TokenReader.finish} reports the problem.
 */
export function tokenReader(spec: Spec): TokenReader {
  const s = new Scanner(spec, true);
  return {
    async read(word) {
      await s.settle();
      return s.read(word);
    },
    async peek(word) {
      await s.settle();
      return s.peek(word);
    },
    async finish() {
      await s.settle();
      if (s.problem) {
        throw s.problem;
      }
      return s.finish();
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
  const s = new Scanner(spec, false);
  await s.readAll(before);
  return s.next(partial);
}

/**
 * Read `names` after the last command on `path` as names of subcommands, the
 * way the parser reads a token where no option can be. Each name that names
 * a subcommand enters it, and the names end at the first one that doesn't.
 * That name is an error where the parser reports it as an unknown or
 * ambiguous command. Otherwise it's an argument, and the names after it are
 * ignored. Every command on `path` must be loaded.
 */
export function readNames(path: CommandPath, names: readonly string[]): Promise<NamesRead> {
  return new Scanner(path[0], true).readNames(path, names);
}

/**
 * Parse the input tokens using the given CLI spec.
 *
 * This resolves to a `ParseResult`, which contains the array of subcommands
 * used, the provided options, the arguments, and the action to run. If
 * parsing fails, the promise rejects.
 */
export async function parse(input: readonly string[], spec: Spec): Promise<ParseResult> {
  const s = new Scanner(spec, true);
  await s.readAll(input);
  return s.finish();
}
