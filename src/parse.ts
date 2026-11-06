import type { Action, CommandPath, Option, Spec, Subcommand } from "./types.js";
import { analyze } from "./analyze.js";
import type { BaseToken, TokenOption, TokenSubcommand } from "./analyze.js";
import { asArray, getMaxArgs, getMinArgs, setEach } from "./util.js";
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

export { getMaxArgs, getMinArgs };

// TODO: Replace all instances of ParseError with a bespoke error type

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
  const path: [Spec, ...Subcommand[]] = [spec];
  const actions: Action[] = [];
  const optionActions: Action[] = [];

  if (spec.action) {
    actions.push(spec.action);
  } else if (spec.requiresSubcommand) {
    actions.push(builtinUsageAction);
  }

  let commandArgsMin: number = getMinArgs(spec.args);
  let commandArgsMax: number = getMaxArgs(spec.args);

  const foundArgs: string[] = [];
  const foundOptions: Map<string, string[]> = new Map();

  // This has to be a type assertion otherwise TS will incorrectly
  // infer that the variable is never reassigned
  let optionArgs = null as string[] | null;
  let optionArgsMin = 0;
  let optionArgsMax = 0;
  let requiredSeparator = false as string | boolean;
  let argSeparatorIndex = -1;

  // Each item in this set must be provided
  const dependsOnOptions = [] as Option[];
  // Each item in this set cannot be provided
  const exclusiveOnOptions = [] as Option[];

  const parseOption = (token: TokenOption<Option>) => {
    const option = token.option;

    if (option.exclusiveOn) {
      exclusiveOnOptions.push(option);
    }

    if (option.dependsOn) {
      dependsOnOptions.push(option);
    }

    if (option.action) {
      optionActions.push(option.action);
    }

    // Repeatable options are treated differently so we
    // *have* to branch on this.
    if (option.isRepeatable) {
      const maxRepeat = option.isRepeatable === true ? Infinity : option.isRepeatable;
      // The count carries over from a parent's identical option. A subcommand
      // option with a name of its own keeps a separate count.
      const names = asArray(option.name);
      const existing = foundOptions.get(names[0]);
      const isSharedCount = names.every((name) => foundOptions.get(name) === existing);
      let arr = isSharedCount ? existing : undefined;
      if (!arr) {
        arr = [];
        setEach(foundOptions, option.name, arr);
      }
      if (arr.length >= maxRepeat) {
        throw new ParseError(ctx(), "Too many repetitions");
      }
      arr.push("");
      return;
    }

    optionArgsMin = getMinArgs(option.args);
    optionArgsMax = getMaxArgs(option.args);
    requiredSeparator = option.requiresSeparator ?? false;

    // The last use of an option wins, so a user can override a flag that a shell
    // alias already sets.
    const values: string[] = [];
    setEach(foundOptions, option.name, values);
    if (optionArgsMax > 0) {
      optionArgs = values;
    }
  };

  const closeOption = () => {
    if (optionArgs && optionArgs.length < optionArgsMin) {
      throw new TooFewOptionArguments(optionArgsMin, optionArgsMax, ctx());
    }
    optionArgs = null;
  };

  const parseArg = (token: BaseToken) => {
    // If the final command requires a subcommand, providing too
    // many arguments is allowed because the user has made a typo
    // (they were intending to use a subcommand)
    if (!path[path.length - 1].requiresSubcommand && foundArgs.length >= commandArgsMax) {
      throw new TooManyArguments(token, ctx());
    }
    foundArgs.push(token.literal);
  };

  const parseArgSeparator = () => {
    if (foundArgs.length >= commandArgsMax) {
      throw new ParseError(
        ctx(),
        "Unexpected argument '--', did you mean to use an option instead?",
      );
    }
    argSeparatorIndex = foundArgs.length;
  };

  const parseSubcommand = (token: TokenSubcommand<Subcommand>) => {
    path.push(token.subcommand);
    commandArgsMin = getMinArgs(token.subcommand.args);
    commandArgsMax = getMaxArgs(token.subcommand.args);
    if (token.subcommand.action) {
      actions.push(token.subcommand.action);
    } else if (token.subcommand.requiresSubcommand) {
      actions.push(builtinUsageAction);
    }
  };

  const ctx = () => ({ path }) as ErrorContext;

  const { finalState, tokens } = analyze<Subcommand, Option>(input, spec);

  for (const token of tokens) {
    switch (token.kind) {
      case "subcommand": {
        closeOption();
        parseSubcommand(token);
        break;
      }
      case "arg": {
        closeOption();
        parseArg(token);
        break;
      }
      case "option": {
        closeOption();
        parseOption(token);
        break;
      }
      case "option-arg": {
        if (!optionArgs) {
          throw new InvalidOptionArg(token, ctx());
        }
        if (typeof requiredSeparator === "string" && token.separator !== requiredSeparator) {
          throw new ParseError(
            ctx(),
            `Incorrect separator, use '${requiredSeparator}' instead of '${token.separator}'`,
          );
        }
        optionArgs.push(token.literal);
        break;
      }
      case "unknown-option": {
        throw new UnknownOption(token, ctx());
      }
      case "arg-separator": {
        closeOption();
        parseArgSeparator();
        break;
      }
    }
  }

  const hasOptionAction = optionActions.length > 0;

  if (!hasOptionAction && foundArgs.length < commandArgsMin) {
    throw new TooFewArguments(commandArgsMin, commandArgsMax, ctx());
  }
  if (optionArgs && optionArgs.length < optionArgsMin) {
    throw new TooFewOptionArguments(optionArgsMin, optionArgsMax, ctx());
  }

  // Options in the `{depends,exclusive}On` arrays definitely have the
  // corresponding array, so it's safe to assert non-null in this situation.
  for (const option of dependsOnOptions) {
    for (const name of option.dependsOn!) {
      if (!foundOptions.has(name)) {
        throw new ParseError(ctx(), `${option.name} requires ${name}, add it to fix this error`);
      }
    }
  }
  for (const option of exclusiveOnOptions) {
    for (const name of option.exclusiveOn!) {
      if (foundOptions.has(name)) {
        throw new ParseError(ctx(), `${option.name} can't be used together with ${name}`);
      }
    }
  }
  if (!hasOptionAction) {
    for (const name of finalState.localRequiredOptions.keys()) {
      if (!foundOptions.has(name)) {
        throw new MissingRequiredOption(name, ctx());
      }
    }
    for (const name of finalState.persistentRequiredOptions.keys()) {
      if (!foundOptions.has(name)) {
        throw new MissingRequiredOption(name, ctx());
      }
    }
  }

  return {
    path,
    actions,
    optionActions,
    argSeparatorIndex,
    args: foundArgs,
    options: foundOptions,
  };
}
