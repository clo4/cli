import type { Action, Arg, CommandPath, Option, Spec, Subcommand } from "./types.js";
import { addDefaults, asArray, getMaxArgs, getMinArgs } from "./util.js";
import {
  InvalidOptionArg,
  MissingRequiredOption,
  ParseError,
  TooFewArguments,
  TooFewOptionArguments,
  TooManyArguments,
  UnknownOption,
} from "./errors.js";
import type { ErrorContext } from "./errors.js";
import type { Directives } from "./directives.js";
import { anyName, CommandScope, exactName, optionKey } from "./scope.js";
import type { LiveSubcommand, OptionForm, SubcommandMatching } from "./scope.js";
import { usage as builtinUsageAction } from "./subcommands.js";
import type { NoSubcommand } from "./subcommands.js";

export interface ParseResult {
  args: string[];
  argSeparatorIndex: number;
  options: Map<string, string[]>;
  /**
   * The defaults of the arguments of the option `name` refers to, for an
   * option that wasn't used. Undefined if it was used, or if its first
   * argument is optional or has no default.
   */
  defaults(name: string): string[] | undefined;
  path: CommandPath;
  /**
   * The action to run: the last option action used, or else the selected
   * command's action. A command without an action prints its help.
   */
  action: Action;
}

/** What the token after a command line can be, as the parser would read it. */
export interface NextToken {
  /** The commands from the root to the current one. */
  path: CommandPath;
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
 * Throw if the options used break a `dependsOn` or `exclusiveOn` rule, or if
 * an option that `scope` requires is missing. `path` ends at the command
 * `scope` is for.
 */
function checkOptionRules(
  options: ReadonlyMap<string, string[]>,
  seenOptions: readonly Option[],
  scope: CommandScope,
  path: CommandPath,
): void {
  for (let i = 0; i < seenOptions.length; i++) {
    const option = seenOptions[i];
    if (!option.dependsOn) {
      continue;
    }
    for (const name of option.dependsOn) {
      if (!options.has(name)) {
        throw new ParseError(
          contextAt(path),
          `${asArray(option.name).join("/")} requires ${name}, add it to fix this error`,
        );
      }
    }
  }
  for (let i = 0; i < seenOptions.length; i++) {
    const option = seenOptions[i];
    if (!option.exclusiveOn) {
      continue;
    }
    for (const name of option.exclusiveOn) {
      if (options.has(name)) {
        throw new ParseError(
          contextAt(path),
          `${asArray(option.name).join("/")} can't be used together with ${name}`,
        );
      }
    }
  }
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
        throw new MissingRequiredOption(names, contextAt(path));
      }
      continue;
    }
    for (let j = 0; j < names.length; j++) {
      if (!options.has(names[j])) {
        throw new MissingRequiredOption(names[j], contextAt(path));
      }
    }
  }
}

/** Reads a command line one token at a time. See {@link tokenReader}. */
export interface TokenReader {
  /** Read the next token of the line, and say what it was read as. */
  read(token: string): TokenReading;
}

/**
 * The state of reading one command line, one token at a time. The scope says
 * what each token means at the current command, and this is the only code
 * that decides what the token is read as and keeps what that changes. It
 * never throws: it skips whatever is invalid and keeps going, so
 * {@link readNext} can still read a line that's wrong at the moment, and it
 * keeps the first problem it finds for {@link parse} to throw.
 */
class Scanner implements TokenReader {
  private readonly path: [Spec, ...Subcommand[]];
  // The last option action used.
  private optionAction: Action | undefined = undefined;
  private readonly args: string[] = [];
  private readonly options: Map<string, string[]> = new Map();
  private readonly seenOptions: Option[] = [];
  private argSeparatorIndex = -1;

  // What the current command allows.
  private readonly scope: CommandScope;
  private readonly directives: Directives;

  private hasFoundArg = false;
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

  /**
   * Makes the error for the first token that can't be read the way it's
   * written, like an unknown option or a value an option doesn't take.
   * {@link parse} stops there.
   */
  problem: (() => ParseError) | null = null;

  // The first argument past the command's limit, or a subcommand that didn't
  // match. It's only an error once the whole line is read, because an option
  // action like --help allows it.
  private tooManyArgs: (() => ParseError) | null = null;

  // The uses of each repeatable option, keyed by `optionKey`.
  // A subcommand's copy of a parent's option has the same names, so it
  // continues the parent's uses. An option with other names, even a subset,
  // has uses of its own.
  private readonly repeatedUses: Map<string, RepeatedUses> = new Map();

  constructor(spec: Spec) {
    this.path = [spec];
    this.scope = new CommandScope(spec);
    this.directives = this.scope.directives;
  }

  // A copy of the path, since reading carries on after a problem and can
  // enter a subcommand before the error is made.
  private ctx(): ErrorContext {
    return contextAt(this.path);
  }

  /**
   * Keep the problem `make` describes if it's the first. The error is only
   * made if {@link parse} throws it, since a lenient read never needs it and
   * an error is slow to make. So `make` can't read anything later tokens change.
   */
  private fail(make: (ctx: ErrorContext) => ParseError): void {
    if (!this.problem) {
      const ctx = this.ctx();
      this.problem = () => make(ctx);
    }
  }

  /** Keep the first argument the command has no room for, like {@link fail}. */
  private failArgs(make: (ctx: ErrorContext) => ParseError): void {
    if (!this.tooManyArgs) {
      const ctx = this.ctx();
      this.tooManyArgs = () => make(ctx);
    }
  }

  private unknownOption(option: string): void {
    if (!this.problem) {
      const names = this.scope.suggestionNames();
      this.fail((ctx) => new UnknownOption(option, names, ctx));
    }
  }

  // Every token except an option's value, or an unknown option, ends the
  // previous option. Then the defaults of the optional arguments that weren't
  // given are added, so a bare `--inspect` gets its port.
  private endOption(): void {
    const values = this.values;
    if (values) {
      const given = values.length - this.valuesStart;
      if (given < this.valuesMin) {
        const { valuesMin, valuesMax } = this;
        const name = this.open.name;
        this.fail((ctx) => new TooFewOptionArguments(name, valuesMin, valuesMax, ctx));
      } else {
        addDefaults(values, this.valueArgs, given);
      }
    }
    this.values = null;
  }

  private useOption(option: Option, name: string): void {
    this.endOption();
    const valuesMin = getMinArgs(option.args);
    const valuesMax = getMaxArgs(option.args);
    // Options that require a separator only take attached values.
    const separateMax = option.requiresSeparator ? 0 : valuesMax;
    this.open = { option, name, count: 0, min: valuesMin, separateMax };
    this.seenOptions.push(option);
    if (option.action) {
      this.optionAction = option.action;
    }
    let optionValues: string[];
    if (option.isRepeatable) {
      // A repeatable option collects the values from every use.
      const key = optionKey(option);
      let uses = this.repeatedUses.get(key);
      if (!uses) {
        uses = { values: [], count: 0 };
        this.repeatedUses.set(key, uses);
      }
      if (uses.count >= repeatLimit(option)) {
        this.fail((ctx) => new ParseError(ctx, "Too many repetitions"));
      }
      uses.count += 1;
      optionValues = uses.values;
    } else {
      // The last use of an option wins, so a user can override a flag that a
      // shell alias already sets.
      optionValues = [];
    }
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
      this.fail((ctx) => new InvalidOptionArg(name, ctx));
      return null;
    }
    const problem = this.scope.separatorProblem(option, name, separator);
    if (problem) {
      this.fail((ctx) => new ParseError(ctx, problem));
    }
    this.values.push(token.slice(start));
    return problem === null ? { option, start } : null;
  }

  private addArg(value: string): TokenReading {
    this.endOption();
    if (this.args.length >= this.scope.argsLimit) {
      this.failArgs((ctx) => new TooManyArguments(value, ctx));
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
      this.failArgs(
        (ctx) => new ParseError(ctx, "Unexpected argument '--', did you mean to use an option instead?"),
      );
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
   * Throw if the finished command line is missing anything. Returns what it
   * was parsed as. Only call this when there's no {@link problem}.
   */
  finish(): ParseResult {
    // An option with an action, like --help, works however the rest of the
    // command line is wrong, as long as every token could be read. So does the
    // usage a command shows when no subcommand is named.
    const command = this.scope.command;
    const showsUsage = command.requiresSubcommand && !command.action && this.args.length === 0;
    const skipsChecks = this.optionAction !== undefined || showsUsage;
    if (!skipsChecks && this.tooManyArgs) {
      throw this.tooManyArgs();
    }
    if (!skipsChecks && this.args.length < this.scope.argsMin) {
      throw new TooFewArguments(this.scope.argsMin, this.scope.argsMax, this.ctx());
    }
    this.endOption();
    if (this.problem) {
      throw this.problem();
    }
    if (!skipsChecks) {
      checkOptionRules(this.options, this.seenOptions, this.scope, this.path);
    }
    // Defaults are added after the checks, so they never count as typed. An
    // option action can run with required arguments missing, and then the
    // first default would fill a required argument's place.
    if (!command.requiresSubcommand && this.args.length >= this.scope.argsMin) {
      addDefaults(this.args, command.args, this.args.length);
    }
    return {
      path: this.path,
      action: this.optionAction ?? command.action ?? builtinUsageAction,
      args: this.args,
      argSeparatorIndex: this.argSeparatorIndex,
      options: this.options,
      defaults: (name) => this.defaults(name),
    };
  }

  /** See {@link ParseResult.defaults}. */
  private defaults(name: string): string[] | undefined {
    if (this.options.has(name)) {
      return undefined;
    }
    const args = asArray(this.scope.resolve(name)?.args);
    // An option whose first argument is optional, like `--inspect[=port]`,
    // means something different when it's left out than when it's bare, so
    // its defaults are only for the bare option.
    if (args.length === 0 || args[0].isOptional) {
      return undefined;
    }
    const values: string[] = [];
    addDefaults(values, args);
    return values.length > 0 ? values : undefined;
  }

  /** Whether using `option` next would go over its repeat limit or break an `exclusiveOn` rule. */
  private conflicts(option: Option): boolean {
    if ((this.repeatedUses.get(optionKey(option))?.count ?? 0) >= repeatLimit(option)) {
      return true;
    }
    const options = this.options;
    if (option.exclusiveOn?.some((name) => options.has(name))) {
      return true;
    }
    const names = asArray(option.name);
    return this.seenOptions.some((seen) => seen.exclusiveOn?.some((name) => names.includes(name)));
  }

  /** The options the next token can use. See {@link NextToken.options}. */
  private usableOptions(): UsableOption[] {
    const used = new Set(this.seenOptions.map(optionKey));
    const { local, persistent } = this.scope.live(this.subcommandMatching);
    const usable: UsableOption[] = [];
    for (const { option, names } of [...local, ...persistent]) {
      if (this.conflicts(option)) {
        continue;
      }
      usable.push({ option, forms: this.scope.forms(option, names), used: used.has(optionKey(option)) });
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
    return {
      path: [...this.path],
      directives: { ...this.directives },
      optionsAllowed: this.optionsAllowed,
      subcommands: !afterSeparator && this.subcommandMatching ? this.scope.subcommands() : [],
      options: this.optionsAllowed ? this.usableOptions() : [],
      value: open && {
        option: open,
        arg: argAt(asArray(open.args), count),
        required: count < min,
      },
      arg: open ? undefined : argAt(asArray(command.args), this.args.length),
    };
  }

  read(token: string): TokenReading {
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
      this.path.push(meaning.command);
      this.scope.enter(meaning.command);
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
   * Keep why `token` names no subcommand, like {@link failArgs}, if the
   * current command has subcommands of its own or requires one.
   */
  private failUnmatched(token: string, exactOnly: boolean): void {
    const command = this.scope.command;
    if (command.subcommands?.length || command.requiresSubcommand) {
      const unmatched = this.scope.matchSubcommand(token, exactOnly) as NoSubcommand;
      this.failArgs((ctx) => {
        const { message, didYouMean } = unmatched.reason();
        return new ParseError(ctx, message, didYouMean);
      });
    }
  }
}

/** The argument at `index`, reusing a final variadic argument. */
function argAt(args: readonly Arg[], index: number): Arg | undefined {
  if (index < args.length) {
    return args[index];
  }
  const last = args[args.length - 1];
  return last?.isVariadic ? last : undefined;
}

/**
 * Start reading a command line for `spec`, to say what each token is read as
 * in turn. Reads leniently, like {@link readNext}.
 */
export function tokenReader(spec: Spec): TokenReader {
  return new Scanner(spec);
}

/**
 * Work out what the token after `before` can be, and how the parser reads
 * `partial`: whether it's an option, and if so, whether it has a value
 * attached. Reads leniently, so a line that's wrong at the moment still has
 * an answer. Completion is built on this.
 */
export function readNext(spec: Spec, before: readonly string[], partial: string): NextToken {
  const s = new Scanner(spec);
  for (const token of before) {
    s.read(token);
  }
  const next = s.next();
  let attached: NextToken["attached"] = null;
  let partialIsOption = false;
  if (partial !== "" && next.optionsAllowed) {
    const reading = s.read(partial);
    partialIsOption =
      reading.kind === "options" || reading.kind === "unknown" || reading.kind === "separator";
    const found = reading.kind === "options" ? reading.attached : null;
    const arg = found && asArray(found.option.args)[0];
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
 * {@link tokenReader}.
 */
export function readToken(spec: Spec, before: readonly string[], token: string): TokenReading {
  const s = new Scanner(spec);
  for (const earlier of before) {
    s.read(earlier);
  }
  return s.read(token);
}

/**
 * Parse the input tokens using the given CLI spec.
 *
 * This returns a `ParseResult`, which contains the array of
 * subcommands used, the provided options, the arguments, and the action to
 * run.
 *
 * If parsing fails, this function throws.
 */
export function parse(input: readonly string[], spec: Spec): ParseResult {
  const s = new Scanner(spec);
  for (let i = 0; i < input.length; i++) {
    s.read(input[i]);
    if (s.problem) {
      throw s.problem();
    }
  }
  return s.finish();
}
