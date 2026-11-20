import type { ActionInit, Spec } from "./types.js";
import { getHelp, printUsageError } from "./help.js";
import { ParseError } from "./errors.js";
import { parse } from "./parse.js";
import { describeThrown, printError } from "./util.js";
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
 * Every argument's parser runs before the action. Parse errors print
 * a message and usage to stderr, with code 1. A command line with several
 * problems, like a missing option and a value its parser rejected, prints a
 * message for each. Errors thrown by actions or loaders print their message
 * without a stack trace, with code 1.
 *
 * In a CLI entry file, call without top-level `await`. This lets a bundler keep
 * the library in the entry chunk when loaded commands also import it.
 *
 * @param spec - The root command definition.
 * @param options - Command-line input and process exit-code behavior.
 * @returns The selected action's exit code, or 1 on a reported error.
 */
export async function run(spec: Spec, options?: RunOptions): Promise<number> {
  const code = await exitCodeOf(spec, options?.argv ?? defaultArgs());
  if (options?.setExitCode !== false) {
    const maybeProcess = globalThis as typeof globalThis & { process?: { exitCode?: number } };
    if (maybeProcess.process) {
      maybeProcess.process.exitCode = code;
    }
  }
  return code;
}

/** The exit code of running `argv` against `spec`. */
async function exitCodeOf(spec: Spec, argv: readonly string[]): Promise<number> {
  let result: ParseResult;
  try {
    result = await parse(argv, spec);
  } catch (error) {
    return reportParseError(error);
  }
  const actionInit: ActionInit<unknown> = {
    help: (helpOptions) => getHelp(helpOptions?.path ?? result.path, helpOptions),
    args: result.args,
    path: result.path,
    argSeparatorIndex: result.argSeparatorIndex,
    options: result.options,
  };
  let exitCode: number | void;
  try {
    // The spec's own types say what each value is. See `ActionInit`.
    exitCode = await result.action(actionInit as ActionInit);
  } catch (error) {
    return reportThrown(error);
  }
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

function defaultArgs(): readonly string[] {
  const maybeProcess = globalThis as typeof globalThis & {
    process?: { argv?: readonly string[] };
  };
  return maybeProcess.process?.argv?.slice(2) ?? [];
}
