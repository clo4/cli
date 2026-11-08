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
import { CommandScope, optionKey } from "./scope.js";
import type { OptionForm, SubcommandMatch, SubcommandMatching } from "./scope.js";
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
   * The subcommands the token can name, hidden ones included. While the open
   * option can still take a value, only an exact name matches.
   */
  subcommands: readonly Subcommand[];
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

/** The values a repeatable option has collected, and how many times it's been used. */
interface RepeatedUses {
  values: string[];
  count: number;
}

/** How many times `option` can be used. */
function repeatLimit(option: Option): number {
  return typeof option.isRepeatable === "number" ? option.isRepeatable : Infinity;
}

/**
 * Throw if the options used break a `dependsOn` or `exclusiveOn` rule, or if
 * any of `required` is missing.
 */
function checkOptionRules(
  options: ReadonlyMap<string, string[]>,
  seenOptions: readonly Option[],
  required: readonly Option[],
  context: ErrorContext,
): void {
  for (const option of seenOptions) {
    if (!option.dependsOn) {
      continue;
    }
    for (const name of option.dependsOn) {
      if (!options.has(name)) {
        throw new ParseError(
          context,
          `${asArray(option.name).join("/")} requires ${name}, add it to fix this error`,
        );
      }
    }
  }
  for (const option of seenOptions) {
    if (!option.exclusiveOn) {
      continue;
    }
    for (const name of option.exclusiveOn) {
      if (options.has(name)) {
        throw new ParseError(
          context,
          `${asArray(option.name).join("/")} can't be used together with ${name}`,
        );
      }
    }
  }
  for (const option of required) {
    for (const name of asArray(option.name)) {
      if (!options.has(name)) {
        throw new MissingRequiredOption(name, context);
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
 * The state of reading one command line, one token at a time. This is the
 * only code that decides what each input token is. It never throws: it skips
 * whatever is invalid and keeps going, so {@link readNext} can still read a
 * line that's wrong at the moment, and it keeps the first problem it finds for
 * {@link parse} to throw. Each method handles one kind of token, and says what
 * the token was read as.
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
  private readonly scope: CommandScope = new CommandScope();
  private readonly directives: Directives = this.scope.directives;

  private hasFoundArg = false;

  // The last option used, and how many more separate tokens it can take as
  // values. While it has room, a token that isn't an option or `--` becomes its
  // value. A subcommand's exact name ends it unless a value is required.
  // `useOption` sets all of these and `closeOption` clears them.
  private openOption: Option | null = null;
  private openOptionName = "";
  private valueCount = 0;
  private valueMin = 0;
  private separateValueMax = 0;

  // The values of the last option, checked against its arity when it ends.
  // Unlike the counts above, this includes values attached with a separator.
  // A repeatable option keeps adding to the same array, so this use's values
  // start at `valuesStart`.
  private values: string[] | null = null;
  private valuesStart = 0;
  private valuesMin = 0;
  private valuesMax = 0;
  private valueArgs: readonly Arg[] = [];

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
    this.scope.enter(spec);
  }

  // A copy of the path, since reading carries on after a problem and can
  // enter a subcommand before the error is made.
  private ctx(): ErrorContext {
    return { path: [...this.path] };
  }

  /** Whether the open option can take the next token as a value. */
  private get hasRoomForValue(): boolean {
    return this.valueCount < this.separateValueMax;
  }

  private findOption(name: string): Option | null {
    return this.scope.resolve(name);
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
        const { openOptionName, valuesMin, valuesMax } = this;
        this.fail((ctx) => new TooFewOptionArguments(openOptionName, valuesMin, valuesMax, ctx));
      } else {
        addDefaults(values, this.valueArgs, given);
      }
    }
    this.values = null;
  }

  /** End the open option, so no later token can be its value. */
  private closeOption(): void {
    this.endOption();
    this.openOption = null;
    this.valueCount = this.valueMin = this.separateValueMax = 0;
  }

  private useOption(option: Option, name: string): void {
    this.endOption();
    this.openOption = option;
    this.openOptionName = name;
    this.valueCount = 0;
    this.valueMin = getMinArgs(option.args);
    // Options that require a separator only take attached values.
    this.separateValueMax = option.requiresSeparator ? 0 : getMaxArgs(option.args);
    this.seenOptions.push(option);
    if (option.action) {
      this.optionAction = option.action;
    }
    const names = asArray(option.name);
    const options = this.options;

    let optionValues: string[];
    if (option.isRepeatable) {
      // A repeatable option collects the values from every use. Without
      // arguments, each use adds an empty string, so the values count the uses.
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
      // Another option may have taken one of the names since the last use.
      for (const other of names) {
        options.set(other, uses.values);
      }
      if (!option.args) {
        uses.values.push("");
        return;
      }
      optionValues = uses.values;
    } else {
      // The last use of an option wins, so a user can override a flag that a
      // shell alias already sets.
      optionValues = [];
      for (const other of names) {
        options.set(other, optionValues);
      }
    }

    this.valuesMin = this.valueMin;
    this.valuesMax = getMaxArgs(option.args);
    if (this.valuesMax > 0) {
      this.values = optionValues;
      this.valuesStart = optionValues.length;
      this.valueArgs = asArray(option.args);
    }
  }

  /** Add a value to the open option. Returns whether it's a value the option accepts. */
  private addValue(value: string, separator: string): boolean {
    this.valueCount += 1;
    if (!this.values) {
      const name = this.openOptionName;
      this.fail((ctx) => new InvalidOptionArg(name, ctx));
      return false;
    }
    const problem = this.scope.separatorProblem(this.openOption!, this.openOptionName, separator);
    if (problem) {
      this.fail((ctx) => new ParseError(ctx, problem));
    }
    this.values.push(value);
    return problem === null;
  }

  /** Add a separate token as a value of the open option. */
  private value(token: string): TokenReading {
    this.addValue(token, "");
    return { kind: "value", option: this.openOption! };
  }

  /**
   * Add a value attached to the option's own token, starting at `start`. It's
   * the option's only value, so no later token can be one. Returns where the
   * value starts, or null if the option doesn't accept it.
   */
  private addAttachedValue(
    start: number,
    value: string,
    separator: string,
  ): { option: Option; start: number } | null {
    const option = this.openOption!;
    const accepted = this.addValue(value, separator);
    this.valueMin = this.separateValueMax = 0;
    return accepted ? { option, start } : null;
  }

  /**
   * Whether the command already has all the arguments it takes. A command that
   * requires a subcommand takes none.
   */
  private get argsAreFull(): boolean {
    return this.scope.command.requiresSubcommand === true || this.args.length >= this.scope.argsMax;
  }

  private addArg(value: string): TokenReading {
    this.endOption();
    if (this.argsAreFull) {
      this.failArgs((ctx) => new TooManyArguments(value, ctx));
    }
    this.args.push(value);
    return { kind: "argument" };
  }

  /** Read `--`. Every token after it is an argument. */
  private argSeparator(): TokenReading {
    this.closeOption();
    // A command that requires a subcommand allows `--` alone, and reports
    // any argument after it.
    const command = this.scope.command;
    if (this.argsAreFull && !command.requiresSubcommand) {
      this.failArgs(
        (ctx) => new ParseError(ctx, "Unexpected argument '--', did you mean to use an option instead?"),
      );
    }
    this.argSeparatorIndex = this.args.length;
    return { kind: "separator" };
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
    if (this.valueCount < this.valueMin || (this.hasRoomForValue && this.separateValueMax === Infinity)) {
      return null;
    }
    return { exactOnly: this.hasRoomForValue };
  }

  /**
   * The subcommand the next token enters if it's `token`, or why it enters
   * none. Null if the next token can't be a subcommand at all.
   */
  private subcommandFor(token: string): SubcommandMatch | null {
    const matching = this.subcommandMatching;
    return matching && this.scope.matchSubcommand(token, matching.exactOnly);
  }

  private enterSubcommand(command: Subcommand): TokenReading {
    this.closeOption();
    this.path.push(command);
    this.scope.enter(command);
    return { kind: "subcommand", command };
  }

  /** Read a token like `-abc`, `+x` or `-ovalue`. */
  private shortOptions(token: string): TokenReading {
    const leadingChar = token[0];

    // Parse as a single dash or plus with an arg. Try dash and plus options
    // first if:
    // - the options exist
    // - the options take args
    // - the first non-leading character isn't an option
    const dashOption = this.findOption(leadingChar);
    if (dashOption?.args && !this.findOption(token.slice(0, 2))) {
      this.useOption(dashOption, leadingChar);
      const attached = this.addAttachedValue(1, token.slice(1), "");
      return { kind: "options", options: [dashOption], attached };
    }

    // Parse as chained short options. If we got here, the option wasn't `-` or `+`.
    const used: Option[] = [];
    let attached: { option: Option; start: number } | null = null;
    for (let char = 1; char < token.length; char++) {
      const optionName = leadingChar + token[char];
      const option = this.findOption(optionName);
      if (!option) {
        // An open option takes anything unknown as a value, like `-5`.
        if (char === 1 && this.hasRoomForValue) {
          return this.value(token);
        }
        this.unknownOption(optionName);
        continue;
      }

      this.useOption(option, optionName);
      used.push(option);
      if (char === token.length - 1) {
        break;
      }

      const sep = this.scope.leadingSeparator(token.slice(char + 1));
      // An option without args still takes a separated value, so that `-v=1`
      // fails like `--verbose=1`, unless the next character is an option.
      if (option.args || (sep && !this.findOption(leadingChar + token[char + 1]))) {
        const argStart = char + sep.length + 1;
        attached = this.addAttachedValue(argStart, token.slice(argStart), sep);
        break;
      }
    }
    return used.length > 0 ? { kind: "options", options: used, attached } : { kind: "unknown" };
  }

  /**
   * Read a token like `--name` or `--name=value`, or any token when options
   * aren't POSIX compliant. Returns null if the token should be an argument.
   */
  private longOption(token: string): TokenReading | null {
    const found = this.scope.firstSeparator(token);
    const optionName = found ? token.slice(0, found.index) : token;
    const option = this.findOption(optionName);
    if (option) {
      this.useOption(option, optionName);
      let attached: { option: Option; start: number } | null = null;
      if (found) {
        const valueStart = found.index + found.separator.length;
        attached = this.addAttachedValue(valueStart, token.slice(valueStart), found.separator);
      }
      return { kind: "options", options: [option], attached };
    }
    // POSIX-noncompliant option means that there's nothing "option-like". Any
    // token can be an option if it matches an option name, and if it's not an
    // option then it's just a regular argument.
    if (this.directives.flagsArePosixNoncompliant) {
      return null;
    }
    if (this.hasRoomForValue) {
      return this.value(token);
    }
    // The option is unknown and looks like a POSIX-compliant option, so
    // it's an unknown option instead of an arg.
    this.unknownOption(optionName);
    return { kind: "unknown" };
  }

  /**
   * Read a token that isn't `--`, a subcommand or an option. It's a value of
   * the open option if that has room, and otherwise an argument, which stops
   * later tokens from being subcommands. `unmatched` is why the token isn't a
   * subcommand, if it could have been one.
   */
  private valueOrArg(token: string, unmatched: NoSubcommand | null): TokenReading {
    if (this.hasRoomForValue) {
      return this.value(token);
    }
    // Where a subcommand could be, a token the command has no room for is a
    // subcommand that didn't match.
    if (unmatched && this.argsAreFull) {
      const command = this.scope.command;
      if (command.subcommands?.length || command.requiresSubcommand) {
        this.failArgs((ctx) => {
          const { message, didYouMean } = unmatched.reason();
          return new ParseError(ctx, message, didYouMean);
        });
      }
    }
    this.hasFoundArg = true;
    return this.addArg(token);
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
      checkOptionRules(this.options, this.seenOptions, this.scope.required(), this.ctx());
    }
    // Defaults are added after the checks, so they never count as typed. An
    // option action can run with required arguments missing, and then the
    // first default would fill a required argument's place.
    if (!command.requiresSubcommand && this.args.length >= this.scope.argsMin) {
      addDefaults(this.args, asArray(command.args), this.args.length);
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
    const open = this.openOption && this.hasRoomForValue ? this.openOption : null;
    const command = this.scope.command;
    // Every token after `--` is an argument.
    const afterSeparator = this.argSeparatorIndex !== -1;
    const optionsAllowed = !afterSeparator && this.optionsAllowed;
    return {
      path: [...this.path],
      directives: { ...this.directives },
      optionsAllowed,
      subcommands: !afterSeparator && this.subcommandMatching ? this.scope.subcommands() : [],
      options: optionsAllowed ? this.usableOptions() : [],
      value: open && {
        option: open,
        arg: argAt(asArray(open.args), this.valueCount),
        required: this.valueCount < this.valueMin,
      },
      arg: open ? undefined : argAt(asArray(command.args), this.args.length),
    };
  }

  /** Whether the next token can be an option. Once options must stop, every token is an argument. */
  private get optionsAllowed(): boolean {
    return !(this.directives.optionsMustPrecedeArguments && this.hasFoundArg);
  }

  read(token: string): TokenReading {
    // Every token after `--` is an argument.
    if (this.argSeparatorIndex !== -1) {
      return this.addArg(token);
    }
    const optionsAllowed = this.optionsAllowed;

    // "--" disables option & subcommand parsing, so it's checked first.
    if (token === "--" && optionsAllowed) {
      return this.argSeparator();
    }

    const subcommand = this.subcommandFor(token);
    if (subcommand?.command) {
      return this.enterSubcommand(subcommand.command);
    }

    if (optionsAllowed) {
      const flagsArePosixNoncompliant = this.directives.flagsArePosixNoncompliant;
      const first = token.charCodeAt(0);
      const isDoubleDash = first === 45 /* - */ && token.charCodeAt(1) === 45;
      if (
        !flagsArePosixNoncompliant &&
        token.length > 1 &&
        (first === 45 || first === 43) /* + */ &&
        !isDoubleDash
      ) {
        return this.shortOptions(token);
      }
      if (flagsArePosixNoncompliant || (token.length > 2 && isDoubleDash)) {
        const reading = this.longOption(token);
        if (reading) {
          return reading;
        }
      }
    }

    return this.valueOrArg(token, subcommand);
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
  for (const token of input) {
    s.read(token);
    if (s.problem) {
      throw s.problem();
    }
  }
  return s.finish();
}
