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

  const { action, options } = result;
  const actionInit: ActionInit = {
    help: (helpOptions) => getHelp(helpOptions?.path ?? result.path, helpOptions),
    args: result.args,
    path: result.path,
    argSeparatorIndex: result.argSeparatorIndex,
    options: {
      options,
      has: (name) => options.has(name),
      get: (name) => (options.get(name) ?? result.defaults(name))?.[0],
      all: (name) => options.get(name) ?? result.defaults(name),
      count: (name) => options.get(name)?.length ?? 0,
    },
  };

  let exitCode: number | void;
  try {
    const actionResult = action(actionInit);
    exitCode = typeof actionResult === "object" ? await actionResult : actionResult;
  } catch (error) {
    printError(describeThrown(error));
    return 1;
  }

  return Math.min(Math.max(exitCode ?? 0, 0), 255);
}

/**
 * The message for a value an action threw. A value that isn't an Error is shown
 * as JSON where it can be, since `String` turns an object into
 * "[object Object]".
 */
function describeThrown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      // A cycle or a BigInt, which JSON can't show.
    }
  }
  return String(value);
}

function defaultArgs(): readonly string[] {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { argv?: readonly string[] };
  };
  return maybeProcess.process?.argv?.slice(2) ?? [];
}
