import type { ActionInit, Spec } from "./types.js";
import { getHelp, printUsageError } from "./help.js";
import { ParseError } from "./errors.js";
import { parseOrWait } from "./parse.js";
import { printError } from "./util.js";
import type { ParseResult } from "./parse.js";

export { printError };

/** How {@link run} reads the command line and reports the exit code. */
export interface RunOptions {
  /** The command line to parse. Default: `process.argv.slice(2)`. */
  argv?: readonly string[];

  /**
   * Set `process.exitCode` to the exit code once the action has finished.
   * Default: true. With false, the code is only the value `run` resolves to.
   */
  setExitCode?: boolean;
}

/**
 * Parse a command line, run the selected action and resolve to its exit code.
 * Set `process.exitCode` unless `options.setExitCode` is `false`. Never call
 * `process.exit`.
 *
 * A command without an action prints help. The last supplied option action
 * takes precedence over the command action and bypasses required-input checks.
 * Sync and async actions are supported. Returning nothing means code 0.
 * Numeric return values are limited to 0–255.
 *
 * Parse errors print a message and usage to stderr, with code 1. Errors thrown
 * by actions or loaders print their message without a stack trace, with code 1.
 *
 * In a CLI entry file, call without top-level `await`. This lets a bundler keep
 * the library in the entry chunk when loaded commands also import it.
 *
 * @param spec - The root command definition.
 * @param options - Command-line input and process exit-code behavior.
 * @returns The selected action's exit code, or 1 on a reported error.
 */
export function run(spec: Spec, options?: RunOptions): Promise<number> {
  // This isn't an async function, because one costs more to compile on a
  // cold start. Anything thrown here still becomes a rejected promise, as it
  // would in an async function.
  try {
    const code = exitCodeOf(spec, options?.argv ?? defaultArgs());
    return options?.setExitCode === false ? code : code.then(setExitCode);
  } catch (error) {
    return Promise.reject(error);
  }
}

/** The exit code of running `input` against `spec`. */
function exitCodeOf(spec: Spec, input: readonly string[]): Promise<number> {
  let result: ParseResult | Promise<ParseResult>;
  try {
    result = parseOrWait(input, spec);
  } catch (error: unknown) {
    return Promise.resolve(reportParseError(error));
  }
  // Only a `loadSpec` that returned a promise makes the parse wait.
  return result instanceof Promise ? result.then(runAction, reportParseError) : runAction(result);
}

function setExitCode(code: number): number {
  const maybeProcess = globalThis as typeof globalThis & { process?: { exitCode?: number } };
  if (maybeProcess.process) {
    maybeProcess.process.exitCode = code;
  }
  return code;
}

/**
 * Run the action `result` picked. It's a function of its own so that a usage
 * error, which runs no action, doesn't compile it.
 */
function runAction(result: ParseResult): Promise<number> {
  const action = result.action;
  const actionInit: ActionInit = {
    help: (helpOptions) => getHelp(helpOptions?.path ?? result.path, helpOptions),
    args: result.args,
    path: result.path,
    argSeparatorIndex: result.argSeparatorIndex,
    options: result.options,
  };

  let actionResult: ReturnType<typeof action>;
  try {
    actionResult = action(actionInit);
  } catch (error) {
    return Promise.resolve(reportThrown(error));
  }
  return typeof actionResult === "object" ? settle(actionResult) : Promise.resolve(exitStatus(actionResult));
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
    return 1;
  }
  // Anything else came from a `loadSpec`.
  return reportThrown(error);
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
