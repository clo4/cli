import type { ActionInit, Spec } from "./types.js";
import { getHelp } from "./help.js";
import { ParseError, UnknownOption } from "./errors.js";
import { parse } from "./parse.js";
import type { ParseResult } from "./parse.js";

/**
 * Parse argv and execute the selected action.
 *
 * The final command action runs unless a parsed option has an action. Option
 * actions take precedence so helpers like `--help` can run without satisfying
 * the selected command's required arguments.
 */
export async function run(spec: Spec, args: readonly string[] = defaultArgs()): Promise<number> {
  let result: ParseResult;

  try {
    result = parse(args, spec);
  } catch (error: unknown) {
    if (error instanceof UnknownOption) {
      const helpMessage = getHelp(error.context.path, {
        description: false,
        didYouMean: {
          input: error.option,
          choices: error.validOptions,
        },
      });
      printError(`${error.message}\n\n${helpMessage}`);
    } else if (error instanceof ParseError) {
      printError(`${error.message}\n\n${getHelp(error.context.path, { description: false })}`);
    } else {
      printError(`${error}`);
    }
    return 1;
  }

  const action = result.optionActions.at(-1) ?? result.actions.at(-1);
  if (!action) {
    return 1;
  }

  const options = result.options;
  const actionInit: ActionInit = {
    help: (helpOptions) => getHelp(helpOptions?.path ?? result.path, helpOptions),
    args: result.args,
    path: result.path,
    argSeparatorIndex: result.argSeparatorIndex,
    options: {
      options,
      has: (name) => options.has(name),
      get: (name) => options.get(name)?.[0],
      all: (name) => options.get(name),
      count: (name) => options.get(name)?.length ?? 0,
    },
  };

  let exitCode: number | void;
  try {
    const actionResult = action(actionInit);
    exitCode = typeof actionResult === "object" ? await actionResult : actionResult;
  } catch (error) {
    printError(error instanceof Error ? error.message : String(error));
    return 1;
  }

  return Math.min(Math.max(exitCode ?? 0, 0), 255);
}

export function printError(...strings: unknown[]): void {
  console.error("Error:", ...strings);
}

function defaultArgs(): readonly string[] {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { argv?: readonly string[] };
  };
  return maybeProcess.process?.argv?.slice(2) ?? [];
}
