import type { ActionInit, Spec } from "./types.js";
import { getHelp, printUsageError } from "./help.js";
import { ParseError } from "./errors.js";
import { parse } from "./parse.js";
import { printError } from "./util.js";
import type { ParseResult } from "./parse.js";

export { printError };

/**
 * Parse argv and execute the selected action.
 *
 * The selected command's action runs unless a parsed option has an action.
 * Option actions take precedence so helpers like `--help` can run without
 * satisfying the selected command's required arguments. A command without an
 * action prints its help.
 */
export async function run(spec: Spec, args: readonly string[] = defaultArgs()): Promise<number> {
  let result: ParseResult;

  try {
    result = parse(args, spec);
  } catch (error: unknown) {
    if (error instanceof ParseError) {
      printUsageError(error.context.path, error.message, error.didYouMean);
    } else {
      printError(`${error}`);
    }
    return 1;
  }

  const { action } = result;
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

function defaultArgs(): readonly string[] {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { argv?: readonly string[] };
  };
  return maybeProcess.process?.argv?.slice(2) ?? [];
}
