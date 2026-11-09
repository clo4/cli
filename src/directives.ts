import type { Subcommand } from "./types.js";
import { asArray } from "./util.js";

/** The parser directives in effect for a command, with defaults filled in. */
export interface Directives {
  optionArgSeparators: readonly string[];
  flagsArePosixNoncompliant: boolean;
  optionsMustPrecedeArguments: boolean;
  subcommandsMatchUniquePrefix: boolean;
}

/** The directives in effect when no command sets any. */
export function defaultDirectives(): Directives {
  return {
    optionArgSeparators: ["="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: false,
  };
}

/**
 * Update `directives` with the ones `configured` sets, when entering the
 * command that sets them. A subcommand inherits each directive until it sets
 * its own.
 */
export function applyDirectives(
  directives: Directives,
  configured: NonNullable<Subcommand["parserDirectives"]>,
): void {
  if (configured.optionArgSeparators) {
    directives.optionArgSeparators = asArray(configured.optionArgSeparators);
  }
  if (typeof configured.subcommandsMatchUniquePrefix === "boolean") {
    directives.subcommandsMatchUniquePrefix = configured.subcommandsMatchUniquePrefix;
  }
  if (typeof configured.optionsMustPrecedeArguments === "boolean") {
    directives.optionsMustPrecedeArguments = configured.optionsMustPrecedeArguments;
  }
  if (typeof configured.flagsArePosixNoncompliant === "boolean") {
    directives.flagsArePosixNoncompliant = configured.flagsArePosixNoncompliant;
  }
}
