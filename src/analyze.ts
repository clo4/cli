/**
 * How a spec reads a command line: what each token is, the argument it's
 * for, every problem the parser finds and the token it's in, and what the
 * action gets. It's for tools built around a spec, like an editor, a linter
 * for scripts that call a CLI, or the playground on the site.
 *
 * It's an entry point of its own, so a CLI that never analyzes a line never
 * loads it.
 *
 * @module
 */

import type { Spec } from "./types.js";
import { ParseError } from "./errors.js";
import { tokenReader } from "./parse.js";
import type { ParseResult, TokenReading } from "./parse.js";

export type { ParseResult, TokenReading };

/** Something the parser can't accept about a command line, and where it is. */
export interface Problem {
  /** What's wrong, in the words `run` prints. */
  message: string;
  /**
   * The index of the token it's in, or -1 for the program's name. A problem
   * with a command, like an argument it's missing, is in the token that names
   * the command. Undefined for a problem in no token, like an invalid default.
   */
  token: number | undefined;
  /** Where the value starts in the token, for a value attached to its option. */
  start: number | undefined;
}

/** How a spec reads a command line. See {@link analyze}. */
export interface Analysis {
  /** What the parser read each token as, in order. */
  tokens: TokenReading[];
  /** Everything `run` would report about the line. Empty if it parses. */
  problems: Problem[];
  /** What the action gets, or null if there are problems. */
  result: ParseResult | null;
}

/**
 * How `spec` reads `argv`, the command line after the program's name. Every
 * token is read, even after one that's wrong, so each has a reading. The
 * problems are the ones `run` would print, and the result is what its action
 * would get.
 *
 * Rejects only if a `loadSpec` does.
 */
export async function analyze(spec: Spec, argv: readonly string[]): Promise<Analysis> {
  const reader = tokenReader(spec);
  const tokens: TokenReading[] = [];
  for (const token of argv) {
    tokens.push(await reader.read(token));
  }
  try {
    return { tokens, problems: [], result: await reader.finish() };
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw error;
    }
    const problems = (error.problems ?? [error]).map(({ message, context }) => ({
      message,
      token: context.token,
      start: context.start,
    }));
    return { tokens, problems, result: null };
  }
}
