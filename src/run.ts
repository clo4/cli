import type { ActionInit, Spec } from "./types.js";
import { getHelp, printUsageError } from "./help.js";
import { ParseError } from "./errors.js";
import { host } from "./host.js";
import { parse } from "./parse.js";
import { describeThrown, print, printError } from "./util.js";
import type { ParseResult } from "./parse.js";

export { print, printError };

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
  let code = 1;
  let result: ParseResult | null = null;
  try {
    result = await parse(options?.argv ?? host.argv(), spec);
  } catch (error) {
    reportParseError(error);
  }
  if (result) {
    const actionInit: ActionInit<unknown> = {
      help: (helpOptions) => getHelp(helpOptions?.path ?? result.path, helpOptions),
      args: result.args,
      path: result.path,
      argSeparatorIndex: result.argSeparatorIndex,
      options: result.options,
    };
    try {
      // The spec's own types say what each value is. See `ActionInit`.
      const exitCode = await result.action(actionInit as ActionInit);
      code = Math.min(Math.max(exitCode ?? 0, 0), 255);
    } catch (error) {
      printError(describeThrown(error));
    }
  }
  if (options?.setExitCode !== false) {
    host.setExitCode(code);
  }
  return code;
}

function reportParseError(error: unknown): void {
  if (error instanceof ParseError) {
    printUsageError(error.context.path, error.message, error.didYouMean);
  } else {
    // Anything else came from a `loadSpec`.
    printError(describeThrown(error));
  }
}
