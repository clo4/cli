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
export function run(spec: Spec, args?: readonly string[]): Promise<number> {
  // This isn't an async function, because one costs more to compile on a
  // cold start. Anything thrown here still becomes a rejected promise, as it
  // would in an async function.
  try {
    const input = args === undefined ? defaultArgs() : args;
    let result: ParseResult;
    try {
      result = parse(input, spec);
    } catch (error: unknown) {
      return Promise.resolve(reportParseError(error));
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

    let actionResult: ReturnType<typeof action>;
    try {
      actionResult = action(actionInit);
    } catch (error) {
      return Promise.resolve(reportThrown(error));
    }
    return typeof actionResult === "object"
      ? settle(actionResult)
      : Promise.resolve(exitStatus(actionResult));
  } catch (error) {
    return Promise.reject(error);
  }
}

/** Wait for the value an action returned as an object, usually a promise. */
async function settle(pending: unknown): Promise<number> {
  let exitCode: number | void;
  try {
    exitCode = (await pending) as number | void;
  } catch (error) {
    return reportThrown(error);
  }
  return exitStatus(exitCode);
}

function exitStatus(exitCode: number | void): number {
  return Math.min(Math.max(exitCode ?? 0, 0), 255);
}

function reportParseError(error: unknown): number {
  if (error instanceof ParseError) {
    printUsageError(error.context.path, error.message, error.didYouMean);
  } else {
    printError(`${error}`);
  }
  return 1;
}

function reportThrown(error: unknown): number {
  printError(describeThrown(error));
  return 1;
}

/**
 * The message for a value an action threw. A value that isn't an Error is shown
 * as JSON where it can be, since `String` turns an object into
 * "[object Object]".
 */
function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
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
