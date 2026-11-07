import type { Action, CommandPath, Option, Spec, Subcommand } from "./types.js";
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
import { usage as builtinUsageAction } from "./help.js";

export interface ParseResult {
  args: string[];
  argSeparatorIndex: number;
  options: Map<string, string[]>;
  path: CommandPath;
  actions: Action[];
  optionActions: Action[];
}

/** Everything {@link scan} learns about a command line. */
export interface ScanResult extends ParseResult {
  /** Every use of an option, in order. */
  seenOptions: Option[];
  /** Non-persistent options of the final command, in definition order. */
  localOptions: Option[];
  /**
   * Persistent options from every command on the path, in definition order.
   * A later option shadows an earlier one with the same name.
   */
  persistentOptions: Option[];
  /** The option that can still take a separate value, and how many it has. */
  openOption: { option: Option; valueCount: number } | null;
}

export { getMaxArgs, getMinArgs };

function hasName(names: string | readonly string[], name: string): boolean {
  return typeof names === "string" ? names === name : names.includes(name);
}

/**
 * Find the option `name` refers to. Local options win over persistent ones, and
 * within each list a later definition wins over an earlier one.
 */
function findOption(local: readonly Option[], persistent: readonly Option[], name: string) {
  for (let i = local.length - 1; i >= 0; i--) {
    if (hasName(local[i].name, name)) return local[i];
  }
  for (let i = persistent.length - 1; i >= 0; i--) {
    if (hasName(persistent[i].name, name)) return persistent[i];
  }
  return null;
}

/** Every name that's valid as an option here, for "did you mean" suggestions. */
function optionNames(local: readonly Option[], persistent: readonly Option[]): string[] {
  const names: string[] = [];
  for (const options of [local, persistent]) {
    const seen = new Set<string>();
    for (const option of options) {
      for (const name of asArray(option.name)) {
        if (!seen.has(name)) {
          seen.add(name);
          names.push(name);
        }
      }
    }
  }
  return names;
}

/**
 * Find the subcommand `token` names. An exact name always wins. With
 * `allowPrefix`, a token that's a prefix of exactly one command's names
 * matches that command. An empty token is a prefix of every name, so it never
 * matches by prefix.
 */
export function matchSubcommand(
  subcommands: readonly Subcommand[],
  token: string,
  allowPrefix: boolean,
): Subcommand | null {
  allowPrefix &&= token !== "";
  let match: Subcommand | null = null;
  let prefixCount = 0;
  for (const candidate of subcommands) {
    const names = candidate.name;
    if (typeof names === "string") {
      if (names === token) return candidate;
      if (allowPrefix && names.startsWith(token)) {
        match = candidate;
        prefixCount += 1;
      }
      continue;
    }
    // Count each command at most once, however many of its names match.
    let prefixMatched = false;
    for (const name of names) {
      if (name === token) return candidate;
      if (allowPrefix && !prefixMatched && name.startsWith(token)) {
        prefixMatched = true;
        match = candidate;
        prefixCount += 1;
      }
    }
  }
  return prefixCount === 1 ? match : null;
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

/** The state of one {@link scan}. Each method handles one kind of token. */
class Scanner {
  readonly path: [Spec, ...Subcommand[]];
  readonly actions: Action[] = [];
  readonly optionActions: Action[] = [];
  readonly args: string[] = [];
  readonly options: Map<string, string[]> = new Map();
  readonly seenOptions: Option[] = [];
  argSeparatorIndex = -1;

  // What the current command allows.
  local: Option[] = [];
  readonly persistent: Option[] = [];
  private readonly localRequired: Option[] = [];
  private readonly persistentRequired: Option[] = [];
  private subcommands: readonly Subcommand[] | undefined = undefined;
  private commandArgsMin = 0;
  private commandArgsMax = 0;
  private separators: readonly string[] = ["="];
  posixCompliantOptions = true;
  private subcommandsMatchUniquePrefix = false;
  optionsMustPrecedeArguments = false;
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

  // How many times each repeatable option has been used, keyed by the array
  // its names share in `options`.
  private readonly repeatCounts: Map<string[], number> = new Map();

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

  // Make `command` the current command. Its non-persistent options replace the
  // previous command's, and its persistent options are added to the inherited ones.
  private enterCommand(command: Spec | Subcommand): void {
    this.local = [];
    // The previous command's options aren't valid here, so neither are its
    // required ones.
    this.localRequired.length = 0;
    if (command.options) {
      for (const option of command.options) {
        if (option.isPersistent) {
          this.persistent.push(option);
          if (option.isRequired) this.persistentRequired.push(option);
        } else {
          this.local.push(option);
          if (option.isRequired) this.localRequired.push(option);
        }
      }
    }
    this.subcommands = command.subcommands;
    this.commandArgsMin = getMinArgs(command.args);
    this.commandArgsMax = getMaxArgs(command.args);
    if (command.action) {
      this.actions.push(command.action);
    } else if (command.requiresSubcommand) {
      this.actions.push(builtinUsageAction);
    }
    const directives = command.parserDirectives;
    if (directives) {
      if (directives.optionArgSeparators) {
        this.separators = asArray(directives.optionArgSeparators);
      }
      // A subcommand inherits each directive until it sets its own.
      if (typeof directives.subcommandsMatchUniquePrefix === "boolean") {
        this.subcommandsMatchUniquePrefix = directives.subcommandsMatchUniquePrefix;
      }
      if (typeof directives.optionsMustPrecedeArguments === "boolean") {
        this.optionsMustPrecedeArguments = directives.optionsMustPrecedeArguments;
      }
      if (typeof directives.flagsArePosixNoncompliant === "boolean") {
        this.posixCompliantOptions = !directives.flagsArePosixNoncompliant;
      }
    }
  }

  private findOption(name: string): Option | null {
    return findOption(this.local, this.persistent, name);
  }

  private unknownOption(option: string, index: number, start: number, end: number): UnknownOption {
    return new UnknownOption(
      { option, validOptions: optionNames(this.local, this.persistent), index, start, end },
      this.ctx(),
    );
  }

  // Every token except an option's value, or an unknown option, ends the
  // previous option.
  private endOption(): void {
    if (this.strict && this.values && this.values.length - this.valuesStart < this.valuesMin) {
      throw new TooFewOptionArguments(this.valuesMin, this.valuesMax, this.ctx());
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
    if (option.action) this.optionActions.push(option.action);
    const names = asArray(option.name);
    const options = this.options;

    let optionValues: string[];
    if (option.isRepeatable) {
      // A repeatable option collects the values from every use. Without
      // arguments, each use adds an empty string, so the values count the uses.
      const maxRepeat = option.isRepeatable === true ? Infinity : option.isRepeatable;
      // The count carries over from a parent's identical option. A subcommand
      // option with a name of its own keeps a separate count.
      const existing = options.get(names[0]);
      let isSharedCount = true;
      for (const other of names) {
        if (options.get(other) !== existing) isSharedCount = false;
      }
      let uses = isSharedCount ? existing : undefined;
      if (!uses) {
        uses = [];
        for (const other of names) options.set(other, uses);
      }
      const count = this.repeatCounts.get(uses) ?? uses.length;
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

  private addValue(index: number, start: number, end: number, value: string, separator: string): void {
    this.valueCount += 1;
    if (!this.values) {
      if (this.strict) {
        throw new InvalidOptionArg(
          { option: this.openOptionName, arg: value, index, start, end },
          this.ctx(),
        );
      }
      return;
    }
    const requiredSeparator = this.requiredSeparator;
    if (this.strict && typeof requiredSeparator === "string" && separator !== requiredSeparator) {
      throw new ParseError(
        this.ctx(),
        `Incorrect separator, use '${requiredSeparator}' instead of '${separator}'`,
      );
    }
    this.values.push(value);
  }

  private addArg(index: number, value: string): void {
    this.endOption();
    // If the final command requires a subcommand, providing too many arguments
    // is allowed because the user has made a typo (they were intending to use
    // a subcommand)
    const path = this.path;
    if (this.strict && !path[path.length - 1].requiresSubcommand && this.args.length >= this.commandArgsMax) {
      throw new TooManyArguments({ value, index }, this.ctx());
    }
    this.args.push(value);
  }

  /** Read `--` and every token after it as arguments. */
  argSeparator(input: readonly string[], index: number): void {
    this.closeOption();
    if (this.strict && this.args.length >= this.commandArgsMax) {
      throw new ParseError(this.ctx(), "Unexpected argument '--', did you mean to use an option instead?");
    }
    this.argSeparatorIndex = this.args.length;
    for (index += 1; index < input.length; index++) {
      this.addArg(index, input[index]);
    }
  }

  /** Enter the subcommand `token` names, if any. Returns whether it did. */
  tryEnterSubcommand(token: string): boolean {
    if (this.hasFoundArg || !this.subcommands) return false;
    // A required or variadic option value takes priority over a subcommand.
    const hasRoomForValue = this.hasRoomForValue;
    const valueIsRequired =
      this.valueCount < this.valueMin || (hasRoomForValue && this.separateValueMax === Infinity);
    if (valueIsRequired) return false;
    // A literal match always wins. A short optional value could be a prefix
    // of a subcommand's name, so only an exact match can end an option that
    // still has room.
    const allowPrefix = this.subcommandsMatchUniquePrefix && !hasRoomForValue;
    const command = matchSubcommand(this.subcommands, token, allowPrefix);
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
      this.addValue(index, 1, token.length, token.slice(1), "");
      return;
    }

    // Parse as chained short options. If we got here, the option wasn't `-` or `+`.
    for (let char = 1; char < token.length; char++) {
      const optionName = leadingChar + token[char];
      const option = this.findOption(optionName);
      if (!option) {
        // An open option takes anything unknown as a value, like `-5`.
        if (char === 1 && this.hasRoomForValue) {
          this.addValue(index, 0, token.length, token, "");
          return;
        }
        if (this.strict) throw this.unknownOption(optionName, index, char, char + 1);
        continue;
      }

      this.useOption(option, optionName);

      if (option.args && char < token.length - 1) {
        const sep = leadingSeparator(token.slice(char + 1), this.separators);
        const argStart = char + sep.length + 1;
        this.addValue(index, argStart, token.length, token.slice(argStart), sep);
        return;
      }
    }
  }

  /**
   * Read a token like `--name` or `--name=value`, or any token when options
   * aren't POSIX compliant. Returns false if the token should be an argument.
   */
  longOption(token: string, index: number): boolean {
    const found = firstSeparator(token, this.separators);
    const optionName = found ? token.slice(0, found.index) : token;
    const option = this.findOption(optionName);
    if (option) {
      this.useOption(option, optionName);
      if (found) {
        const valueStart = found.index + found.sep.length;
        this.addValue(index, valueStart, token.length, token.slice(valueStart), found.sep);
      }
      return true;
    }
    // POSIX-noncompliant option means that there's nothing "option-like". Any
    // token can be an option if it matches an option name, and if it's not an
    // option then it's just a regular argument.
    if (!this.posixCompliantOptions) return false;
    if (this.hasRoomForValue) {
      this.addValue(index, 0, token.length, token, "");
      return true;
    }
    // The option is unknown and looks like a POSIX-compliant option, so
    // it's an unknown option instead of an arg.
    if (this.strict) throw this.unknownOption(optionName, index, 0, optionName.length);
    return true;
  }

  /**
   * Read a token that isn't `--`, a subcommand or an option. It's a value of
   * the open option if that has room, and otherwise an argument, which stops
   * later tokens from being subcommands.
   */
  valueOrArg(token: string, index: number): void {
    if (this.hasRoomForValue) {
      this.addValue(index, 0, token.length, token, "");
      return;
    }
    this.hasFoundArg = true;
    this.addArg(index, token);
  }

  /** Throw if the finished command line is missing anything. */
  finish(): void {
    // An option with an action, like --help, works without the command's
    // arguments or required options.
    const hasOptionAction = this.optionActions.length > 0;
    if (!hasOptionAction && this.args.length < this.commandArgsMin) {
      throw new TooFewArguments(this.commandArgsMin, this.commandArgsMax, this.ctx());
    }
    this.endOption();
    const required = hasOptionAction ? [] : [...this.localRequired, ...this.persistentRequired];
    checkOptionRules(this.options, this.seenOptions, required, this.ctx());
  }
}

/**
 * Read a command line against a spec in one pass.
 *
 * This is the only code that decides what each input token is. With `strict`,
 * it throws on the first problem, which is what {@link parse} needs. Without
 * it, it never throws: it skips whatever is invalid and keeps going, so
 * completion can still read a line that's wrong at the moment.
 */
export function scan(input: readonly string[], spec: Spec, strict: boolean): ScanResult {
  const s = new Scanner(spec, strict);

  for (let index = 0; index < input.length; index++) {
    const token = input[index];

    // "--" disables option & subcommand parsing, so it's checked first.
    if (token === "--") {
      s.argSeparator(input, index);
      break;
    }

    if (s.tryEnterSubcommand(token)) continue;

    if (!(s.optionsMustPrecedeArguments && s.hasFoundArg)) {
      const first = token.charCodeAt(0);
      const isDoubleDash = first === 45 /* - */ && token.charCodeAt(1) === 45;
      if (
        s.posixCompliantOptions &&
        token.length > 1 &&
        (first === 45 || first === 43) /* + */ &&
        !isDoubleDash
      ) {
        s.shortOptions(token, index);
        continue;
      }
      if (!s.posixCompliantOptions || (token.length > 2 && isDoubleDash)) {
        if (s.longOption(token, index)) continue;
      }
    }

    s.valueOrArg(token, index);
  }

  if (strict) s.finish();

  const open = s.openOption;
  return {
    path: s.path,
    actions: s.actions,
    optionActions: s.optionActions,
    args: s.args,
    argSeparatorIndex: s.argSeparatorIndex,
    options: s.options,
    seenOptions: s.seenOptions,
    localOptions: s.local,
    persistentOptions: s.persistent,
    openOption: open && s.hasRoomForValue ? { option: open, valueCount: s.valueCount } : null,
  };
}

/**
 * Parse the input tokens using the given CLI spec.
 *
 * This returns a `ParseResult`, which contains the array of
 * subcommands used, the provided options, and the arguments.
 *
 * If parsing fails, this function throws.
 *
 * This function is exposed to make it easier to build a custom runner.
 */
export function parse(input: readonly string[], spec: Spec): ParseResult {
  return scan(input, spec, true);
}
