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
 * Read a command line against a spec in one pass.
 *
 * This is the only code that decides what each input token is. With `strict`,
 * it throws on the first problem, which is what {@link parse} needs. Without
 * it, it never throws: it skips whatever is invalid and keeps going, so
 * completion can still read a line that's wrong at the moment.
 *
 * This runs once per process, so it's written for a cold start: one loop, few
 * helper functions and plain arrays, because every extra function is compiled
 * the first time it runs.
 */
export function scan(input: readonly string[], spec: Spec, strict: boolean): ScanResult {
  const path: [Spec, ...Subcommand[]] = [spec];
  const actions: Action[] = [];
  const optionActions: Action[] = [];
  const args: string[] = [];
  const options: Map<string, string[]> = new Map();
  const seenOptions: Option[] = [];
  let argSeparatorIndex = -1;

  // What the current command allows.
  let local: Option[] = [];
  const persistent: Option[] = [];
  const localRequired: Option[] = [];
  const persistentRequired: Option[] = [];
  let subcommands: readonly Subcommand[] | undefined;
  let commandArgsMin = 0;
  let commandArgsMax = 0;
  let separators: readonly string[] = ["="];
  let posixCompliantOptions = true;
  let subcommandsMatchUniquePrefix = false;
  let optionsMustPrecedeArguments = false;
  let hasFoundArg = false;

  // The last option used, and how many more separate tokens it can take as
  // values. While it has room, a token that isn't an option or `--` becomes its
  // value. A subcommand's exact name ends it unless a value is required.
  let openOption: Option | null = null;
  let openOptionName = "";
  let valueCount = 0;
  let valueMin = 0;
  let separateValueMax = 0;

  // The values of the last option, checked against its arity when it ends.
  // Unlike the counts above, this includes values attached with a separator.
  let values: string[] | null = null;
  let valuesMin = 0;
  let valuesMax = 0;
  let requiredSeparator: string | boolean = false;

  const ctx = (): ErrorContext => ({ path });

  // Make `command` the current command. Its non-persistent options replace the
  // previous command's, and its persistent options are added to the inherited ones.
  const enterCommand = (command: Spec | Subcommand) => {
    local = [];
    if (command.options) {
      for (const option of command.options) {
        if (option.isPersistent) {
          persistent.push(option);
          if (option.isRequired) persistentRequired.push(option);
        } else {
          local.push(option);
          if (option.isRequired) localRequired.push(option);
        }
      }
    }
    subcommands = command.subcommands;
    commandArgsMin = getMinArgs(command.args);
    commandArgsMax = getMaxArgs(command.args);
    if (command.action) {
      actions.push(command.action);
    } else if (command.requiresSubcommand) {
      actions.push(builtinUsageAction);
    }
    const directives = command.parserDirectives;
    if (directives) {
      if (directives.optionArgSeparators) {
        separators = asArray(directives.optionArgSeparators);
      }
      if (directives.subcommandsMatchUniquePrefix) subcommandsMatchUniquePrefix = true;
      if (directives.optionsMustPrecedeArguments) optionsMustPrecedeArguments = true;
      if (typeof directives.flagsArePosixNoncompliant === "boolean") {
        posixCompliantOptions = !directives.flagsArePosixNoncompliant;
      }
    }
  };

  // Every token except an option's value, or an unknown option, ends the
  // previous option.
  const endOption = () => {
    if (strict && values && values.length < valuesMin) {
      throw new TooFewOptionArguments(valuesMin, valuesMax, ctx());
    }
    values = null;
  };

  const useOption = (option: Option, name: string) => {
    endOption();
    openOption = option;
    openOptionName = name;
    valueCount = 0;
    valueMin = getMinArgs(option.args);
    // Options that require a separator only take attached values.
    separateValueMax = option.requiresSeparator ? 0 : getMaxArgs(option.args);
    seenOptions.push(option);
    if (option.action) optionActions.push(option.action);
    const names = asArray(option.name);

    // Repeatable options count uses instead of collecting values.
    if (option.isRepeatable) {
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
      if (strict && uses.length >= maxRepeat) {
        throw new ParseError(ctx(), "Too many repetitions");
      }
      uses.push("");
      return;
    }

    valuesMin = valueMin;
    valuesMax = getMaxArgs(option.args);
    requiredSeparator = option.requiresSeparator ?? false;
    // The last use of an option wins, so a user can override a flag that a
    // shell alias already sets.
    const optionValues: string[] = [];
    for (const other of names) options.set(other, optionValues);
    if (valuesMax > 0) values = optionValues;
  };

  const addValue = (
    index: number,
    start: number,
    end: number,
    value: string,
    separator: string,
  ) => {
    valueCount += 1;
    if (!values) {
      if (strict) {
        throw new InvalidOptionArg(
          { option: openOptionName, arg: value, index, start, end },
          ctx(),
        );
      }
      return;
    }
    if (strict && typeof requiredSeparator === "string" && separator !== requiredSeparator) {
      throw new ParseError(
        ctx(),
        `Incorrect separator, use '${requiredSeparator}' instead of '${separator}'`,
      );
    }
    values.push(value);
  };

  const addArg = (index: number, value: string) => {
    endOption();
    // If the final command requires a subcommand, providing too many arguments
    // is allowed because the user has made a typo (they were intending to use
    // a subcommand)
    if (strict && !path[path.length - 1].requiresSubcommand && args.length >= commandArgsMax) {
      throw new TooManyArguments({ value, index }, ctx());
    }
    args.push(value);
  };

  enterCommand(spec);

  tokens: for (let index = 0; index < input.length; index++) {
    const token = input[index];

    // "--" as a token disables option & subcommand parsing, so this needs
    // to be checked first.
    if (token === "--") {
      endOption();
      if (strict && args.length >= commandArgsMax) {
        throw new ParseError(
          ctx(),
          "Unexpected argument '--', did you mean to use an option instead?",
        );
      }
      argSeparatorIndex = args.length;
      openOption = null;
      valueCount = valueMin = separateValueMax = 0;
      for (index += 1; index < input.length; index++) {
        addArg(index, input[index]);
      }
      break tokens;
    }

    const hasRoomForValue = valueCount < separateValueMax;

    // 1. Try to parse as a subcommand
    // A required or variadic option value takes priority over a subcommand.
    const valueIsRequired =
      valueCount < valueMin || (hasRoomForValue && separateValueMax === Infinity);
    if (!hasFoundArg && !valueIsRequired && subcommands) {
      // A literal match always wins. A short optional value could be a prefix
      // of a subcommand's name, so only an exact match can end an option that
      // still has room.
      const allowPrefix = subcommandsMatchUniquePrefix && !hasRoomForValue;
      let command: Subcommand | null = null;
      let prefixCount = 0;
      commands: for (const candidate of subcommands) {
        const names = candidate.name;
        if (typeof names === "string") {
          if (names === token) {
            command = candidate;
            prefixCount = -1;
            break commands;
          }
          if (allowPrefix && names.startsWith(token)) {
            command = candidate;
            prefixCount += 1;
          }
          continue commands;
        }
        // Count each command at most once, however many of its names match.
        let prefixMatched = false;
        for (const name of names) {
          if (name === token) {
            command = candidate;
            prefixCount = -1;
            break commands;
          }
          if (allowPrefix && !prefixMatched && name.startsWith(token)) {
            prefixMatched = true;
            command = candidate;
            prefixCount += 1;
          }
        }
      }
      // -1 is an exact match. Otherwise only a unique prefix match counts.
      if (command && (prefixCount === -1 || prefixCount === 1)) {
        endOption();
        openOption = null;
        valueCount = valueMin = separateValueMax = 0;
        path.push(command);
        enterCommand(command);
        continue tokens;
      }
    }

    // 2. Try to parse as an option
    if (!(optionsMustPrecedeArguments && hasFoundArg)) {
      const first = token.charCodeAt(0);
      const isDoubleDash = first === 45 && token.charCodeAt(1) === 45;
      if (
        posixCompliantOptions &&
        token.length > 1 &&
        (first === 45 /* - */ || first === 43) /* + */ &&
        !isDoubleDash
      ) {
        const leadingChar = token[0];

        // 2.a. Parse as a single dash or plus with an arg
        // Try dash and plus options first if:
        // - the options exist
        // - the options take args
        // - the first non-leading character isn't an option
        const dashOption = findOption(local, persistent, leadingChar);
        if (dashOption?.args && !findOption(local, persistent, token.slice(0, 2))) {
          useOption(dashOption, leadingChar);
          addValue(index, 1, token.length, token.slice(1), "");
          continue tokens;
        }

        // 2.b. Parse as a chainable short option
        // If we fell through, the option wasn't `-` or `+`
        for (let char = 1; char < token.length; char++) {
          const optionName = leadingChar + token[char];
          const option = findOption(local, persistent, optionName);
          if (!option) {
            // An open option takes anything unknown as a value, like `-5`.
            if (char === 1 && valueCount < separateValueMax) {
              addValue(index, 0, token.length, token, "");
              continue tokens;
            }
            if (strict) {
              throw new UnknownOption(
                {
                  option: optionName,
                  validOptions: optionNames(local, persistent),
                  index,
                  start: char,
                  end: char + 1,
                },
                ctx(),
              );
            }
            continue;
          }

          useOption(option, optionName);

          if (option.args && char < token.length - 1) {
            const remainingChars = token.slice(char + 1);
            let sep = "";
            for (const candidate of separators) {
              if (remainingChars.startsWith(candidate)) {
                sep = candidate;
                break;
              }
            }
            const argStart = char + sep.length + 1;
            addValue(index, argStart, token.length, token.slice(argStart), sep);
            break;
          }
        }
        continue tokens;
      }

      if (!posixCompliantOptions || (token.length > 2 && isDoubleDash)) {
        // 2.c. Parse as a long option or posix-noncompliant option

        // POSIX-noncompliant option means that there's nothing "option-like".
        // Any token can be an option if it matches an option name, and if it's
        // not an option then it's just a regular argument.

        // The last separator that appears in the token wins.
        let foundSep = "";
        let foundSepIndex = -1;
        for (const sep of separators) {
          const at = token.indexOf(sep);
          if (at !== -1) {
            foundSep = sep;
            foundSepIndex = at;
          }
        }

        const optionName = foundSep ? token.slice(0, foundSepIndex) : token;
        const option = findOption(local, persistent, optionName);
        if (option) {
          useOption(option, optionName);
          if (foundSep) {
            const valueStart = foundSepIndex + foundSep.length;
            addValue(index, valueStart, token.length, token.slice(valueStart), foundSep);
          }
          continue tokens;
        }
        if (posixCompliantOptions) {
          if (valueCount < separateValueMax) {
            addValue(index, 0, token.length, token, "");
            continue tokens;
          }
          // The option is unknown and looks like a posix-compliant option, so
          // it's an unknown option instead of an arg.
          if (strict) {
            throw new UnknownOption(
              {
                option: optionName,
                validOptions: optionNames(local, persistent),
                index,
                start: 0,
                end: optionName.length,
              },
              ctx(),
            );
          }
          continue tokens;
        }
        // Posix noncompliant options fall through to be arguments
      }
    }

    if (valueCount < separateValueMax) {
      addValue(index, 0, token.length, token, "");
      continue tokens;
    }
    hasFoundArg = true;
    addArg(index, token);
  }

  if (strict) {
    const hasOptionAction = optionActions.length > 0;
    if (!hasOptionAction && args.length < commandArgsMin) {
      throw new TooFewArguments(commandArgsMin, commandArgsMax, ctx());
    }
    endOption();
    for (const option of seenOptions) {
      if (!option.dependsOn) continue;
      for (const name of option.dependsOn) {
        if (!options.has(name)) {
          throw new ParseError(ctx(), `${option.name} requires ${name}, add it to fix this error`);
        }
      }
    }
    for (const option of seenOptions) {
      if (!option.exclusiveOn) continue;
      for (const name of option.exclusiveOn) {
        if (options.has(name)) {
          throw new ParseError(ctx(), `${option.name} can't be used together with ${name}`);
        }
      }
    }
    if (!hasOptionAction) {
      for (const required of [localRequired, persistentRequired]) {
        for (const option of required) {
          for (const name of asArray(option.name)) {
            if (!options.has(name)) {
              throw new MissingRequiredOption(name, ctx());
            }
          }
        }
      }
    }
  }

  // TS narrows `openOption` to null because it's only assigned in closures.
  const open = openOption as Option | null;
  return {
    path,
    actions,
    optionActions,
    args,
    argSeparatorIndex,
    options,
    seenOptions,
    localOptions: local,
    persistentOptions: persistent,
    openOption: open && valueCount < separateValueMax ? { option: open, valueCount } : null,
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
