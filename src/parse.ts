import type { Action, Arg, CommandPath, Option, Spec, Subcommand } from "./types.js";
import { asArray, getMaxArgs, getMinArgs } from "./util.js";
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
import { OptionScope } from "./scope.js";
import { matchSubcommand, noSubcommandMatch, usage as builtinUsageAction } from "./subcommands.js";

export interface ParseResult {
  args: string[];
  argSeparatorIndex: number;
  options: Map<string, string[]>;
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
  /** The options and directives in effect. */
  scope: OptionScope;
  /** Whether the token can be an option. */
  optionsAllowed: boolean;
  /**
   * The subcommands the token can name, hidden ones included. While the open
   * option can still take a value, only an exact name matches.
   */
  subcommands: readonly Subcommand[];
  /** The subcommand the token enters if it's `token`. A subcommand wins over an option with the same name. */
  subcommandFor(token: string): Subcommand | null;
  /** The open option, if the token can be its value, and whether it must be. */
  value: { option: Option; arg: Arg | undefined; required: boolean } | null;
  /** The argument the token fills if it isn't an option, subcommand or value. */
  arg: Arg | undefined;
  /** Every use of an option so far, in order. */
  seenOptions: readonly Option[];
  /** Whether using `option` next would go over its repeat limit or break an `exclusiveOn` rule. */
  conflicts(option: Option): boolean;
  /**
   * The partial token, if the parser reads it as an option with a value
   * attached. `prefix` is everything before the value.
   */
  attached: { option: Option; arg: Arg; prefix: string; value: string } | null;
}

/** The first of `separators` that `text` starts with, or "" if none. */
export function leadingSeparator(text: string, separators: readonly string[]): string {
  for (const sep of separators) {
    if (text.startsWith(sep)) return sep;
  }
  return "";
}

/**
 * Find the separator that appears first in `token`, so the value after it can
 * contain the other separators. When two separators start at the same place,
 * the longer one wins. Returns null if there's no separator, or if the one
 * found is empty.
 */
export function firstSeparator(
  token: string,
  separators: readonly string[],
): { index: number; sep: string } | null {
  let sep = "";
  let index = -1;
  for (const candidate of separators) {
    const at = token.indexOf(candidate);
    if (at === -1) continue;
    if (index === -1 || at < index || (at === index && candidate.length > sep.length)) {
      sep = candidate;
      index = at;
    }
  }
  return sep ? { index, sep } : null;
}

/**
 * The values array that every one of `names` shares in `options`, if they all
 * share one. A repeatable option with these names continues that array's uses.
 */
function sharedValues(
  options: ReadonlyMap<string, string[]>,
  names: readonly string[],
): string[] | undefined {
  const existing = options.get(names[0]);
  for (const name of names) {
    if (options.get(name) !== existing) return undefined;
  }
  return existing;
}

/**
 * How many times a repeatable option with these names has been used. The count
 * carries over from a parent's identical option. A subcommand option with a
 * name of its own keeps a separate count.
 */
function repeatCount(
  options: ReadonlyMap<string, string[]>,
  repeatCounts: ReadonlyMap<string[], number>,
  names: readonly string[],
): number {
  const uses = sharedValues(options, names);
  return uses ? (repeatCounts.get(uses) ?? uses.length) : 0;
}

/**
 * Throw if the options used break a `dependsOn` or `exclusiveOn` rule, or if
 * any of `required` is missing.
 */
export function checkOptionRules(
  options: ReadonlyMap<string, string[]>,
  seenOptions: readonly Option[],
  required: readonly Option[],
  context: ErrorContext,
): void {
  for (const option of seenOptions) {
    if (!option.dependsOn) continue;
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
    if (!option.exclusiveOn) continue;
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
      if (!options.has(name)) throw new MissingRequiredOption(name, context);
    }
  }
}

/**
 * The state of reading one command line in a single pass. This is the only
 * code that decides what each input token is. When `strict`, it throws on the
 * first problem, which is what {@link parse} needs. Otherwise it never throws:
 * it skips whatever is invalid and keeps going, so {@link readNext} can still
 * read a line that's wrong at the moment. Each method handles one kind of
 * token.
 */
class Scanner {
  readonly path: [Spec, ...Subcommand[]];
  // The last option action used.
  private optionAction: Action | undefined = undefined;
  readonly args: string[] = [];
  readonly options: Map<string, string[]> = new Map();
  readonly seenOptions: Option[] = [];
  argSeparatorIndex = -1;

  // What the current command allows.
  readonly scope: OptionScope = new OptionScope();
  private subcommands: readonly Subcommand[] | undefined = undefined;
  private commandArgsMin = 0;
  private commandArgsMax = 0;
  readonly directives: Directives = this.scope.directives;

  hasFoundArg = false;

  // The last option used, and how many more separate tokens it can take as
  // values. While it has room, a token that isn't an option or `--` becomes its
  // value. A subcommand's exact name ends it unless a value is required.
  // `useOption` sets all of these and `closeOption` clears them.
  openOption: Option | null = null;
  private openOptionName = "";
  valueCount = 0;
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
  private requiredSeparator: string | boolean = false;

  // The first argument past the command's limit, or a subcommand that didn't
  // match. It's only an error once the whole line is read, because an option
  // action like --help allows it.
  private tooManyArgs: ParseError | null = null;

  // How many times each repeatable option has been used, keyed by the array
  // its names share in `options`.
  private readonly repeatCounts: Map<string[], number> = new Map();

  // The last value attached to an option's own token, and where it starts.
  private attached: { option: Option; index: number; start: number } | null = null;

  constructor(
    spec: Spec,
    private readonly strict: boolean,
  ) {
    this.path = [spec];
    this.enterCommand(spec);
  }

  private ctx(): ErrorContext {
    return { path: this.path };
  }

  /** Whether the open option can take the next token as a value. */
  get hasRoomForValue(): boolean {
    return this.valueCount < this.separateValueMax;
  }

  // Make `command` the current command.
  private enterCommand(command: Spec | Subcommand): void {
    this.scope.enter(command);
    this.subcommands = command.subcommands;
    this.commandArgsMin = getMinArgs(command.args);
    this.commandArgsMax = getMaxArgs(command.args);
  }

  private findOption(name: string): Option | null {
    return this.scope.resolve(name);
  }

  private unknownOption(option: string): UnknownOption {
    return new UnknownOption(option, this.scope.suggestionNames(), this.ctx());
  }

  // Every token except an option's value, or an unknown option, ends the
  // previous option.
  private endOption(): void {
    if (this.strict && this.values && this.values.length - this.valuesStart < this.valuesMin) {
      throw new TooFewOptionArguments(this.openOptionName, this.valuesMin, this.valuesMax, this.ctx());
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
    if (option.action) this.optionAction = option.action;
    const names = asArray(option.name);
    const options = this.options;

    let optionValues: string[];
    if (option.isRepeatable) {
      // A repeatable option collects the values from every use. Without
      // arguments, each use adds an empty string, so the values count the uses.
      const maxRepeat = option.isRepeatable === true ? Infinity : option.isRepeatable;
      const count = repeatCount(options, this.repeatCounts, names);
      let uses = sharedValues(options, names);
      if (!uses) {
        uses = [];
        for (const other of names) options.set(other, uses);
      }
      if (this.strict && count >= maxRepeat) {
        throw new ParseError(this.ctx(), "Too many repetitions");
      }
      this.repeatCounts.set(uses, count + 1);
      if (!option.args) {
        uses.push("");
        return;
      }
      optionValues = uses;
    } else {
      // The last use of an option wins, so a user can override a flag that a
      // shell alias already sets.
      optionValues = [];
      for (const other of names) options.set(other, optionValues);
    }

    this.valuesMin = this.valueMin;
    this.valuesMax = getMaxArgs(option.args);
    this.requiredSeparator = option.requiresSeparator ?? false;
    if (this.valuesMax > 0) {
      this.values = optionValues;
      this.valuesStart = optionValues.length;
    }
  }

  /**
   * Add a value to the open option. Returns whether it's a value the option
   * accepts. A lenient read keeps going either way.
   */
  private addValue(value: string, separator: string): boolean {
    this.valueCount += 1;
    if (!this.values) {
      if (this.strict) throw new InvalidOptionArg(this.openOptionName, this.ctx());
      return false;
    }
    const requiredSeparator = this.requiredSeparator;
    let accepted = true;
    if (typeof requiredSeparator === "string" && separator !== requiredSeparator) {
      if (this.strict) {
        throw new ParseError(
          this.ctx(),
          `Incorrect separator, use '${requiredSeparator}' instead of '${separator}'`,
        );
      }
      accepted = false;
    }
    if (requiredSeparator === true && separator === "") {
      if (this.strict) {
        const suggested = this.scope.requiredSeparator(this.openOption!);
        throw new ParseError(
          this.ctx(),
          `Missing separator, use '${suggested}' between ${this.openOptionName} and its value`,
        );
      }
      accepted = false;
    }
    this.values.push(value);
    return accepted;
  }

  /**
   * Add a value attached to the option's own token, the token at `index`,
   * starting at `start`. It's the option's only value, so no later token can be
   * one.
   */
  private addAttachedValue(index: number, start: number, value: string, separator: string): void {
    if (this.addValue(value, separator)) {
      this.attached = { option: this.openOption!, index, start };
    }
    this.valueMin = this.separateValueMax = 0;
  }

  /**
   * Whether the command already has all the arguments it takes. A command that
   * requires a subcommand takes none.
   */
  private get argsAreFull(): boolean {
    const path = this.path;
    return path[path.length - 1].requiresSubcommand === true || this.args.length >= this.commandArgsMax;
  }

  private addArg(value: string): void {
    this.endOption();
    if (this.strict && this.argsAreFull) {
      this.tooManyArgs ??= new TooManyArguments(value, this.ctx());
    }
    this.args.push(value);
  }

  /** Read `--` and every token after it as arguments. */
  argSeparator(input: readonly string[], index: number): void {
    this.closeOption();
    // A command that requires a subcommand allows `--` alone, and reports
    // any argument after it.
    const command = this.path[this.path.length - 1];
    if (this.strict && this.argsAreFull && !command.requiresSubcommand) {
      this.tooManyArgs ??= new ParseError(
        this.ctx(),
        "Unexpected argument '--', did you mean to use an option instead?",
      );
    }
    this.argSeparatorIndex = this.args.length;
    for (index += 1; index < input.length; index++) {
      this.addArg(input[index]);
    }
  }

  /**
   * The subcommands the next token can name. None once an argument is found,
   * or while the open option needs the next token as its value. A required
   * or variadic option value takes priority over a subcommand.
   */
  private get matchableSubcommands(): readonly Subcommand[] | undefined {
    if (!this.subcommands || this.hasFoundArg) return undefined;
    const valueIsRequired =
      this.valueCount < this.valueMin || (this.hasRoomForValue && this.separateValueMax === Infinity);
    return valueIsRequired ? undefined : this.subcommands;
  }

  /** The subcommand the next token enters if it's `token`. */
  subcommandFor(token: string): Subcommand | null {
    const subcommands = this.matchableSubcommands;
    if (!subcommands) return null;
    // A literal match always wins. A short optional value could be a prefix
    // of a subcommand's name, so only an exact match can end an option that
    // still has room.
    const allowPrefix = this.directives.subcommandsMatchUniquePrefix && !this.hasRoomForValue;
    return matchSubcommand(subcommands, token, allowPrefix);
  }

  /** Enter the subcommand `token` names, if any. Returns whether it did. */
  tryEnterSubcommand(token: string): boolean {
    const command = this.subcommandFor(token);
    if (!command) return false;
    this.closeOption();
    this.path.push(command);
    this.enterCommand(command);
    return true;
  }

  /** Read a token like `-abc`, `+x` or `-ovalue`. */
  shortOptions(token: string, index: number): void {
    const leadingChar = token[0];

    // Parse as a single dash or plus with an arg. Try dash and plus options
    // first if:
    // - the options exist
    // - the options take args
    // - the first non-leading character isn't an option
    const dashOption = this.findOption(leadingChar);
    if (dashOption?.args && !this.findOption(token.slice(0, 2))) {
      this.useOption(dashOption, leadingChar);
      this.addAttachedValue(index, 1, token.slice(1), "");
      return;
    }

    // Parse as chained short options. If we got here, the option wasn't `-` or `+`.
    for (let char = 1; char < token.length; char++) {
      const optionName = leadingChar + token[char];
      const option = this.findOption(optionName);
      if (!option) {
        // An open option takes anything unknown as a value, like `-5`.
        if (char === 1 && this.hasRoomForValue) {
          this.addValue(token, "");
          return;
        }
        if (this.strict) throw this.unknownOption(optionName);
        continue;
      }

      this.useOption(option, optionName);
      if (char === token.length - 1) return;

      const sep = leadingSeparator(token.slice(char + 1), this.directives.optionArgSeparators);
      // An option without args still takes a separated value, so that `-v=1`
      // fails like `--verbose=1`, unless the next character is an option.
      if (option.args || (sep && !this.findOption(leadingChar + token[char + 1]))) {
        const argStart = char + sep.length + 1;
        this.addAttachedValue(index, argStart, token.slice(argStart), sep);
        return;
      }
    }
  }

  /**
   * Read a token like `--name` or `--name=value`, or any token when options
   * aren't POSIX compliant. Returns false if the token should be an argument.
   */
  longOption(token: string, index: number): boolean {
    const found = firstSeparator(token, this.directives.optionArgSeparators);
    const optionName = found ? token.slice(0, found.index) : token;
    const option = this.findOption(optionName);
    if (option) {
      this.useOption(option, optionName);
      if (found) {
        const valueStart = found.index + found.sep.length;
        this.addAttachedValue(index, valueStart, token.slice(valueStart), found.sep);
      }
      return true;
    }
    // POSIX-noncompliant option means that there's nothing "option-like". Any
    // token can be an option if it matches an option name, and if it's not an
    // option then it's just a regular argument.
    if (this.directives.flagsArePosixNoncompliant) return false;
    if (this.hasRoomForValue) {
      this.addValue(token, "");
      return true;
    }
    // The option is unknown and looks like a POSIX-compliant option, so
    // it's an unknown option instead of an arg.
    if (this.strict) throw this.unknownOption(optionName);
    return true;
  }

  /**
   * Read a token that isn't `--`, a subcommand or an option. It's a value of
   * the open option if that has room, and otherwise an argument, which stops
   * later tokens from being subcommands.
   */
  valueOrArg(token: string): void {
    if (this.hasRoomForValue) {
      this.addValue(token, "");
      return;
    }
    // Where a subcommand could be, a token the command has no room for is a
    // subcommand that didn't match.
    const subcommands = this.matchableSubcommands;
    if (this.strict && subcommands && this.argsAreFull) {
      const command = this.path[this.path.length - 1];
      if (subcommands.length > 0 || command.requiresSubcommand) {
        const allowPrefix = this.directives.subcommandsMatchUniquePrefix;
        const { message, didYouMean } = noSubcommandMatch(subcommands, token, allowPrefix);
        this.tooManyArgs ??= new ParseError(this.ctx(), message, didYouMean);
      }
    }
    this.hasFoundArg = true;
    this.addArg(token);
  }

  /**
   * Throw if the finished command line is missing anything. Returns the action
   * to run.
   */
  finish(): Action {
    // An option with an action, like --help, works however the rest of the
    // command line is wrong, as long as every token could be read. So does the
    // usage a command shows when no subcommand is named.
    const command = this.path[this.path.length - 1];
    const showsUsage = command.requiresSubcommand && !command.action && this.args.length === 0;
    const skipsChecks = this.optionAction !== undefined || showsUsage;
    if (!skipsChecks && this.tooManyArgs) throw this.tooManyArgs;
    if (!skipsChecks && this.args.length < this.commandArgsMin) {
      throw new TooFewArguments(this.commandArgsMin, this.commandArgsMax, this.ctx());
    }
    this.endOption();
    if (!skipsChecks) {
      checkOptionRules(this.options, this.seenOptions, this.scope.required(), this.ctx());
    }
    return this.optionAction ?? command.action ?? builtinUsageAction;
  }

  /** Whether using `option` next would go over its repeat limit or break an `exclusiveOn` rule. */
  conflicts(option: Option): boolean {
    const names = asArray(option.name);
    const options = this.options;
    if (typeof option.isRepeatable === "number") {
      if (repeatCount(options, this.repeatCounts, names) >= option.isRepeatable) return true;
    }
    if (option.exclusiveOn?.some((name) => options.has(name))) return true;
    return this.seenOptions.some((seen) => seen.exclusiveOn?.some((name) => names.includes(name)));
  }

  /** What the next token can be. See {@link readNext}. */
  next(): Omit<NextToken, "attached"> {
    const open = this.openOption && this.hasRoomForValue ? this.openOption : null;
    const command = this.path[this.path.length - 1];
    // Every token after `--` is an argument.
    const afterSeparator = this.argSeparatorIndex !== -1;
    return {
      path: this.path,
      scope: this.scope,
      optionsAllowed: !afterSeparator && this.optionsAllowed,
      subcommands: (!afterSeparator && this.matchableSubcommands) || [],
      subcommandFor: (token) => (afterSeparator ? null : this.subcommandFor(token)),
      value: open && {
        option: open,
        arg: argAt(asArray(open.args), this.valueCount),
        required: this.valueCount < this.valueMin,
      },
      arg: open ? undefined : argAt(asArray(command.args), this.args.length),
      seenOptions: this.seenOptions,
      conflicts: (option) => this.conflicts(option),
    };
  }

  /** The value attached to the token at `index`, if it has one the option accepts. */
  attachedAt(index: number): { option: Option; start: number } | null {
    return this.attached?.index === index ? this.attached : null;
  }

  /** Whether the next token can be an option. Once options must stop, every token is an argument. */
  get optionsAllowed(): boolean {
    return !(this.directives.optionsMustPrecedeArguments && this.hasFoundArg);
  }

  /** Read every token of `input`. */
  read(input: readonly string[]): void {
    for (let index = 0; index < input.length; index++) {
      const token = input[index];
      const optionsAllowed = this.optionsAllowed;

      // "--" disables option & subcommand parsing, so it's checked first.
      if (token === "--" && optionsAllowed) {
        this.argSeparator(input, index);
        return;
      }

      if (this.tryEnterSubcommand(token)) continue;

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
          this.shortOptions(token, index);
          continue;
        }
        if (flagsArePosixNoncompliant || (token.length > 2 && isDoubleDash)) {
          if (this.longOption(token, index)) continue;
        }
      }

      this.valueOrArg(token);
    }
  }
}

/** The argument at `index`, reusing a final variadic argument. */
function argAt(args: readonly Arg[], index: number): Arg | undefined {
  if (index < args.length) return args[index];
  const last = args[args.length - 1];
  return last?.isVariadic ? last : undefined;
}

/**
 * Work out what the token after `before` can be, and how the parser reads
 * `partial` if it's an option with a value attached. Reads leniently, so a
 * line that's wrong at the moment still has an answer. Completion is built on
 * this.
 */
export function readNext(spec: Spec, before: readonly string[], partial: string): NextToken {
  const s = new Scanner(spec, false);
  s.read(before);
  const next = s.next();
  let attached: NextToken["attached"] = null;
  if (partial !== "" && next.optionsAllowed) {
    // Read the line again with the partial token, so `next` stays as it was.
    const withPartial = new Scanner(spec, false);
    withPartial.read([...before, partial]);
    const found = withPartial.attachedAt(before.length);
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
  return { ...next, attached };
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
  const s = new Scanner(spec, true);
  s.read(input);
  const action = s.finish();
  return {
    path: s.path,
    action,
    args: s.args,
    argSeparatorIndex: s.argSeparatorIndex,
    options: s.options,
  };
}
