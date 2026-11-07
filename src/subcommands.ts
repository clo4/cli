import type { Subcommand } from "./types.js";
import { asArray } from "./util.js";

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
