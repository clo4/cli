import type { Action, Subcommand } from "./types.js";
import type { DidYouMean } from "./errors.js";
import { asArray, print } from "./util.js";

/**
 * Find the subcommand `token` names. An exact name always wins. With
 * `allowPrefix`, a token that's a prefix of exactly one command's names
 * matches that command (see {@link prefixMatches}).
 */
export function matchSubcommand(
  subcommands: readonly Subcommand[],
  token: string,
  allowPrefix: boolean,
): Subcommand | null {
  for (const candidate of subcommands) {
    const names = candidate.name;
    if (typeof names === "string" ? names === token : names.includes(token)) return candidate;
  }
  if (!allowPrefix) return null;
  const matches = prefixMatches(subcommands, token);
  return matches.length === 1 ? matches[0] : null;
}

/**
 * The commands that `token` is a prefix of a name of, each listed once. An
 * empty token is a prefix of every name, so it matches none. A hidden command
 * only matches its exact name, so it can't make a visible command's prefix
 * ambiguous.
 */
export function prefixMatches(subcommands: readonly Subcommand[], token: string): Subcommand[] {
  if (token === "") return [];
  return subcommands.filter(
    (candidate) => !candidate.hidden && asArray(candidate.name).some((name) => name.startsWith(token)),
  );
}

/** The subcommands that help, completion and suggestions show. */
export function visibleSubcommands(subcommands: readonly Subcommand[] | undefined): Subcommand[] {
  return subcommands?.filter((subcommand) => !subcommand.hidden) ?? [];
}

/**
 * Why `token` doesn't name one of `subcommands`, for a token that
 * {@link matchSubcommand} matched none of with the same `allowPrefix`.
 */
export function noSubcommandMatch(
  subcommands: readonly Subcommand[] | undefined,
  token: string,
  allowPrefix: boolean,
): { message: string; didYouMean?: DidYouMean } {
  if (token === "") return { message: "Expected a command, but the value was empty" };
  if (allowPrefix && subcommands) {
    // A unique prefix would have matched, so these are two or more commands.
    const possible = prefixMatches(subcommands, token).flatMap((command) =>
      asArray(command.name).filter((name) => name.startsWith(token)),
    );
    if (possible.length > 0) {
      return { message: `Ambiguous command '${token}', could be: ${possible.join(", ")}` };
    }
  }
  const choices = visibleSubcommands(subcommands).map((command) => asArray(command.name));
  return { message: `Unknown command '${token}'`, didYouMean: { input: token, choices } };
}

/**
 * The action of a command that requires a subcommand and has no action of its
 * own, when the command line names no subcommand: print the command's help.
 */
export const usage: Action = ({ help }) => {
  print(help());
  return 0;
};
