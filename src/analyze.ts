import { asArray, getMaxArgs, getMinArgs } from "./util.js";

interface MinOption {
  name: string | readonly string[];
  args?:
    | { isOptional?: boolean; isVariadic?: boolean }
    | readonly { isOptional?: boolean; isVariadic?: boolean }[];
  isPersistent?: boolean;
  isRequired?: boolean;
  requiresSeparator?: boolean | string;
}

interface MinSubcommand<Option extends MinOption> {
  name: string | readonly string[];
  args?: unknown;
  options?: readonly Option[];
  subcommands?: readonly this[];
  parserDirectives?: {
    optionArgSeparators?: string | readonly string[];
    flagsArePosixNoncompliant?: boolean;
    optionsMustPrecedeArguments?: boolean;
    subcommandsMatchUniquePrefix?: boolean;
  };
}

// Token helpers {{{

export type BaseToken = {
  /** The index in the input that that contains this token */
  index: number;
  /** Inclusive start index */
  start: number;
  /** Non-inclusive (exclusive) end index */
  end: number;
  /** The literal text value */
  literal: string;
};

/** Something that looks like an option but isn't one */
export type TokenUnknownOption = BaseToken & {
  kind: "unknown-option";
  validOptions: string[];
};

/** A value that belongs to either an option or the current command */
export type TokenArg = BaseToken & {
  kind: "arg";
};

/** A token that denotes that all following tokens are arguments */
export type TokenArgSeparator = BaseToken & {
  kind: "arg-separator";
};

/** Some text that is guaranteed to belong to the preceding option (eg. -I%, --config=file.json) */
export type TokenOptionArg = BaseToken & {
  kind: "option-arg";
  option: string;
  separator: string;
};

/** A subcommand, and all the relevant information */
export type TokenSubcommand<Subcommand> = BaseToken & {
  kind: "subcommand";
  subcommand: Subcommand;
};

/** An option */
export type TokenOption<Option> = BaseToken & {
  kind: "option";
  option: Option;
};

/** Any kind of token */
export type Token<Subcommand, Option> =
  | TokenArg
  | TokenArgSeparator
  | TokenSubcommand<Subcommand>
  | TokenOption<Option>
  | TokenUnknownOption
  | TokenOptionArg;

export const $optionArg = (
  index: number,
  start: number,
  end: number,
  literal: string,
  option: string,
  separator: string,
): TokenOptionArg => ({
  kind: "option-arg",
  index,
  literal,
  start,
  end,
  option,
  separator,
});

export const $unknownOption = (
  index: number,
  start: number,
  end: number,
  literal: string,
  validOptions: string[],
): TokenUnknownOption => ({
  kind: "unknown-option",
  index,
  start,
  end,
  literal,
  validOptions,
});

export const $arg = (index: number, start: number, end: number, literal: string): TokenArg => ({
  kind: "arg",
  index,
  start,
  end,
  literal,
});

export const $argSeparator = (
  index: number,
  start: number,
  end: number,
  literal: string,
): TokenArgSeparator => ({
  kind: "arg-separator",
  index,
  start,
  end,
  literal,
});

export const $subcommand = <Subcommand extends MinSubcommand<Option>, Option extends MinOption>(
  index: number,
  start: number,
  end: number,
  literal: string,
  subcommand: Subcommand,
): TokenSubcommand<Subcommand> => {
  return {
    kind: "subcommand",
    index,
    start,
    end,
    literal,
    subcommand,
  };
};

export const $option = <Option extends MinOption>(
  index: number,
  start: number,
  end: number,
  literal: string,
  option: Option,
): TokenOption<Option> => {
  return {
    kind: "option",
    index,
    start,
    end,
    literal,
    option,
  };
};

// }}}

export interface AnalyzeResult<Subcommand, Option> {
  /** The state after the final token has been processed */
  finalState: {
    /** Non-persistent options of the final command, in definition order. */
    localOptions: Option[];
    /**
     * Persistent options from every command on the path, in definition order.
     * A later option shadows an earlier one with the same name.
     */
    persistentOptions: Option[];
    /** Required non-persistent options from every command on the path. */
    localRequiredOptions: Option[];
    /** Required persistent options from every command on the path. */
    persistentRequiredOptions: Option[];
    /** The option still able to take a value, and how many values it has. */
    openOption: { option: Option; valueCount: number } | null;
  };

  /** The list of tokens and their data */
  tokens: Token<Subcommand, Option>[];
}

function hasName(names: string | readonly string[], name: string): boolean {
  return typeof names === "string" ? names === name : names.includes(name);
}

/**
 * Find the option `name` refers to. Local options win over persistent ones, and
 * within each list a later definition wins over an earlier one.
 */
function findOption<Option extends MinOption>(
  local: readonly Option[],
  persistent: readonly Option[],
  name: string,
): Option | null {
  for (let i = local.length - 1; i >= 0; i--) {
    if (hasName(local[i].name, name)) return local[i];
  }
  for (let i = persistent.length - 1; i >= 0; i--) {
    if (hasName(persistent[i].name, name)) return persistent[i];
  }
  return null;
}

/** Every name that's valid as an option here, for "did you mean" suggestions. */
function optionNames(local: readonly MinOption[], persistent: readonly MinOption[]): string[] {
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
 * Lex the input, output some tokens
 *
 * This uses the options and subcommands to categorize the input tokens, and is
 * the only code that decides what a token is, so a value belonging to an option
 * is always an `option-arg`. It never rejects input. Checking that the sequence
 * of tokens is valid is the job of `parse`, and completion reads partial input
 * through this too.
 *
 * This runs once per process, so it's written for a cold start: one loop, few
 * helper functions and plain arrays, because every extra function is compiled
 * the first time it runs.
 */
export function analyze<Subcommand extends MinSubcommand<Option>, Option extends MinOption>(
  input: readonly string[],
  spec: Subcommand,
): AnalyzeResult<Subcommand, Option> {
  const tokens: Token<Subcommand, Option>[] = [];

  let local: Option[] = [];
  const persistent: Option[] = [];
  const localRequired: Option[] = [];
  const persistentRequired: Option[] = [];
  let subcommands: readonly Subcommand[] | undefined;
  let separators: readonly string[] = ["="];
  let hasFoundArg = false;
  let posixCompliantOptions = true;
  let subcommandsMatchUniquePrefix = false;
  let optionsMustPrecedeArguments = false;
  // The option that can still take values. While it has room, a token that
  // isn't an option or `--` becomes its value. A subcommand's exact name ends
  // the option unless a value is required.
  let openOption: Option | null = null;
  let openOptionName = "";
  let optionArgCount = 0;
  let optionArgMin = 0;
  let optionArgMax = 0;

  // Make `command` the current command. Its non-persistent options replace the
  // previous command's, and its persistent options are added to the inherited ones.
  const enterCommand = (command: Subcommand) => {
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

  const startOption = (option: Option, name: string) => {
    openOption = option;
    openOptionName = name;
    optionArgCount = 0;
    optionArgMin = getMinArgs(option.args);
    // Options that require a separator only take attached values.
    optionArgMax = option.requiresSeparator ? 0 : getMaxArgs(option.args);
  };

  const pushOptionArg = (
    index: number,
    start: number,
    end: number,
    literal: string,
    separator: string,
  ) => {
    optionArgCount += 1;
    tokens.push({
      kind: "option-arg",
      index,
      start,
      end,
      literal,
      option: openOptionName,
      separator,
    });
  };

  enterCommand(spec);

  tokens: for (let index = 0; index < input.length; index++) {
    const token = input[index];

    // "--" as a token disables option & subcommand parsing, so this needs
    // to be checked first.
    if (token === "--") {
      openOption = null;
      optionArgCount = optionArgMin = optionArgMax = 0;
      tokens.push({ kind: "arg-separator", index, start: 0, end: 2, literal: token });
      for (index += 1; index < input.length; index++) {
        const tok = input[index];
        tokens.push({ kind: "arg", index, start: 0, end: tok.length, literal: tok });
      }
      break tokens;
    }

    const hasRoomForValue = optionArgCount < optionArgMax;

    // 1. Try to parse as a subcommand
    // A required or variadic option value takes priority over a subcommand.
    const valueIsRequired =
      optionArgCount < optionArgMin || (hasRoomForValue && optionArgMax === Infinity);
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
        openOption = null;
        optionArgCount = optionArgMin = optionArgMax = 0;
        enterCommand(command);
        tokens.push({
          kind: "subcommand",
          index,
          start: 0,
          end: token.length,
          literal: token,
          subcommand: command,
        });
        continue tokens;
      }
    }

    // 2. Try to parse as an option
    if (!(optionsMustPrecedeArguments && hasFoundArg)) {
      const first = token.charCodeAt(0);
      if (
        posixCompliantOptions &&
        token.length > 1 &&
        (first === 45 /* - */ || first === 43) /* + */ &&
        !(first === 45 && token.charCodeAt(1) === 45)
      ) {
        const leadingChar = token[0];

        // 2.a. Parse as a single dash or plus with an arg
        // Try dash and plus options first if:
        // - the options exist
        // - the options take args
        // - the first non-leading character isn't an option
        const dashOption = findOption(local, persistent, leadingChar);
        if (dashOption?.args && !findOption(local, persistent, token.slice(0, 2))) {
          startOption(dashOption, leadingChar);
          tokens.push({
            kind: "option",
            index,
            start: 0,
            end: 1,
            literal: leadingChar,
            option: dashOption,
          });
          pushOptionArg(index, 1, token.length, token.slice(1), "");
          continue tokens;
        }

        // 2.b. Parse as a chainable short option
        // If we fell through, the option wasn't `-` or `+`
        for (let char = 1; char < token.length; char++) {
          const optionName = leadingChar + token[char];
          const option = findOption(local, persistent, optionName);
          if (!option) {
            // An open option takes anything unknown as a value, like `-5`.
            if (char === 1 && optionArgCount < optionArgMax) {
              pushOptionArg(index, 0, token.length, token, "");
              continue tokens;
            }
            tokens.push({
              kind: "unknown-option",
              index,
              start: char,
              end: char + 1,
              literal: optionName,
              validOptions: optionNames(local, persistent),
            });
            continue;
          }

          startOption(option, optionName);
          tokens.push({
            kind: "option",
            index,
            start: char,
            end: char + 1,
            literal: optionName,
            option,
          });

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
            pushOptionArg(index, argStart, token.length, token.slice(argStart), sep);
            break;
          }
        }
        continue tokens;
      }

      if (
        !posixCompliantOptions ||
        (token.length > 2 && first === 45 && token.charCodeAt(1) === 45)
      ) {
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
          startOption(option, optionName);
          tokens.push({
            kind: "option",
            index,
            start: 0,
            end: optionName.length,
            literal: optionName,
            option,
          });
          if (foundSep) {
            const valueStart = foundSepIndex + foundSep.length;
            pushOptionArg(index, valueStart, token.length, token.slice(valueStart), foundSep);
          }
          continue tokens;
        }
        if (posixCompliantOptions) {
          if (optionArgCount < optionArgMax) {
            pushOptionArg(index, 0, token.length, token, "");
            continue tokens;
          }
          // The option is unknown and looks like a posix-compliant option, so
          // it's an "unknown option" instead of an arg.
          tokens.push({
            kind: "unknown-option",
            index,
            start: 0,
            end: optionName.length,
            literal: optionName,
            validOptions: optionNames(local, persistent),
          });
          if (foundSep) {
            const valueStart = foundSepIndex + foundSep.length;
            tokens.push({
              kind: "option-arg",
              index,
              start: valueStart,
              end: token.length,
              literal: token.slice(valueStart),
              option: optionName,
              separator: foundSep,
            });
          }
          continue tokens;
        }
        // Posix noncompliant options fall through to be arguments
      }
    }

    if (optionArgCount < optionArgMax) {
      pushOptionArg(index, 0, token.length, token, "");
      continue tokens;
    }
    hasFoundArg = true;
    tokens.push({ kind: "arg", index, start: 0, end: token.length, literal: token });
  }

  const open = openOption as Option | null;
  return {
    finalState: {
      localOptions: local,
      persistentOptions: persistent,
      localRequiredOptions: localRequired,
      persistentRequiredOptions: persistentRequired,
      openOption:
        open && optionArgCount < optionArgMax ? { option: open, valueCount: optionArgCount } : null,
    },
    tokens,
  };
}
