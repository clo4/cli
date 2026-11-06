import type { Action, CommandPath, Option, Spec, Subcommand } from "./types.js";
import { analyze } from "./analyze.js";
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

  // The values of the option that's still taking arguments, if any.
  let optionArgs: string[] | null = null;
  let optionArgsMin = 0;
  let optionArgsMax = 0;
  let requiredSeparator: string | boolean = false;
  let argSeparatorIndex = -1;

  // Options whose `dependsOn` / `exclusiveOn` are checked at the end.
  let dependsOnOptions: Option[] | null = null;
  let exclusiveOnOptions: Option[] | null = null;

  const ctx = () => ({ path }) as ErrorContext;

  const { finalState, tokens } = analyze<Subcommand, Option>(input, spec);

  for (const token of tokens) {
    // Every token except an option's value ends the option before it. An
    // unknown option is reported as unknown, so it skips this check.
    if (token.kind !== "option-arg" && token.kind !== "unknown-option") {
      if (optionArgs && optionArgs.length < optionArgsMin) {
        throw new TooFewOptionArguments(optionArgsMin, optionArgsMax, ctx());
      }
      optionArgs = null;
    }

    switch (token.kind) {
      case "subcommand": {
        const subcommand = token.subcommand;
        path.push(subcommand);
        commandArgsMin = getMinArgs(subcommand.args);
        commandArgsMax = getMaxArgs(subcommand.args);
        if (subcommand.action) {
          actions.push(subcommand.action);
        } else if (subcommand.requiresSubcommand) {
          actions.push(builtinUsageAction);
        }
        break;
      }
      case "arg": {
        // If the final command requires a subcommand, providing too many
        // arguments is allowed because the user has made a typo (they were
        // intending to use a subcommand)
        if (!path[path.length - 1].requiresSubcommand && foundArgs.length >= commandArgsMax) {
          throw new TooManyArguments(token, ctx());
        }
        foundArgs.push(token.literal);
        break;
      }
      case "option": {
        const option = token.option;
        if (option.exclusiveOn) (exclusiveOnOptions ??= []).push(option);
        if (option.dependsOn) (dependsOnOptions ??= []).push(option);
        if (option.action) optionActions.push(option.action);
        const names = asArray(option.name);

        // Repeatable options count uses instead of collecting values.
        if (option.isRepeatable) {
          const maxRepeat = option.isRepeatable === true ? Infinity : option.isRepeatable;
          // The count carries over from a parent's identical option. A subcommand
          // option with a name of its own keeps a separate count.
          const existing = foundOptions.get(names[0]);
          let isSharedCount = true;
          for (const name of names) {
            if (foundOptions.get(name) !== existing) isSharedCount = false;
          }
          let uses = isSharedCount ? existing : undefined;
          if (!uses) {
            uses = [];
            for (const name of names) foundOptions.set(name, uses);
          }
          if (uses.length >= maxRepeat) {
            throw new ParseError(ctx(), "Too many repetitions");
          }
          uses.push("");
          break;
        }

        optionArgsMin = getMinArgs(option.args);
        optionArgsMax = getMaxArgs(option.args);
        requiredSeparator = option.requiresSeparator ?? false;

        // The last use of an option wins, so a user can override a flag that a
        // shell alias already sets.
        const values: string[] = [];
        for (const name of names) foundOptions.set(name, values);
        if (optionArgsMax > 0) {
          optionArgs = values;
        }
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
        if (foundArgs.length >= commandArgsMax) {
          throw new ParseError(
            ctx(),
            "Unexpected argument '--', did you mean to use an option instead?",
          );
        }
        argSeparatorIndex = foundArgs.length;
        break;
      }
    }
  }

  const hasOptionAction = optionActions.length > 0;

  if (!hasOptionAction && foundArgs.length < commandArgsMin) {
    throw new TooFewArguments(commandArgsMin, commandArgsMax, ctx());
  }
  // TS narrows `optionArgs` to null here because it's only set inside the loop.
  const lastOptionArgs = optionArgs as string[] | null;
  if (lastOptionArgs && lastOptionArgs.length < optionArgsMin) {
    throw new TooFewOptionArguments(optionArgsMin, optionArgsMax, ctx());
  }

  if (dependsOnOptions) {
    for (const option of dependsOnOptions) {
      for (const name of option.dependsOn!) {
        if (!foundOptions.has(name)) {
          throw new ParseError(ctx(), `${option.name} requires ${name}, add it to fix this error`);
        }
      }
    }
  }
  if (exclusiveOnOptions) {
    for (const option of exclusiveOnOptions) {
      for (const name of option.exclusiveOn!) {
        if (foundOptions.has(name)) {
          throw new ParseError(ctx(), `${option.name} can't be used together with ${name}`);
        }
      }
    }
  }
  if (!hasOptionAction) {
    for (const required of [
      finalState.localRequiredOptions,
      finalState.persistentRequiredOptions,
    ]) {
      for (const option of required) {
        for (const name of asArray(option.name)) {
          if (!foundOptions.has(name)) {
            throw new MissingRequiredOption(name, ctx());
          }
        }
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
