import type { Action, Subcommand } from "./types.js";
import type { Directives } from "./directives.js";
import type { DidYouMean } from "./errors.js";
import { asArray, print } from "./util.js";

/** The subcommand a token names, or why it names none. See {@link matchSubcommand}. */
export type SubcommandMatch = { command: Subcommand } | NoSubcommand;

/**
 * Find the subcommand `token` names among `subcommands`, in a command where
 * `directives` are in effect, or else among the persistent subcommands the
 * command `inherited`. An exact name always wins. With
 * `subcommandsMatchUniquePrefix`, a token that's a prefix of exactly one
 * of the command's own names matches that command, unless `exactOnly`. A
 * hidden or inherited command only matches its exact name, so it can't make a
 * visible command's prefix ambiguous or take a prefix meant as an argument,
 * and an empty token is no command's prefix.
 */
export function matchSubcommand(
  subcommands: readonly Subcommand[],
  token: string,
  directives: Readonly<Directives>,
  exactOnly = false,
  inherited: readonly Subcommand[] = [],
): SubcommandMatch {
  for (const candidate of subcommands) {
    if (hasName(candidate, token)) {
      return { command: candidate };
    }
  }
  for (const candidate of inherited) {
    if (hasName(candidate, token)) {
      return { command: candidate };
    }
  }
  const allowPrefix = directives.subcommandsMatchUniquePrefix && !exactOnly;
  const matches = allowPrefix ? prefixMatches(subcommands, token) : [];
  if (matches.length === 1) {
    return { command: matches[0] };
  }
  return new NoSubcommand(withInherited(subcommands, inherited), token, matches);
}

/**
 * A command's own `subcommands` followed by the `inherited` ones it can use,
 * leaving out each inherited one that an earlier command shadows a name of.
 */
export function withInherited(
  subcommands: readonly Subcommand[],
  inherited: readonly Subcommand[],
): readonly Subcommand[] {
  if (inherited.length === 0) {
    return subcommands;
  }
  const all = [...subcommands];
  for (const candidate of inherited) {
    if (!asArray(candidate.name).some((name) => all.some((earlier) => hasName(earlier, name)))) {
      all.push(candidate);
    }
  }
  return all;
}

function hasName(command: Subcommand, token: string): boolean {
  const names = command.name;
  return typeof names === "string" ? names === token : names.includes(token);
}

/** The visible commands that `token` is a prefix of a name of, each listed once. */
function prefixMatches(subcommands: readonly Subcommand[], token: string): Subcommand[] {
  if (token === "") {
    return [];
  }
  return subcommands.filter(
    (candidate) => !candidate.hidden && asArray(candidate.name).some((name) => name.startsWith(token)),
  );
}

/**
 * A token that names no subcommand. The reason is only worked out when asked
 * for, since most tokens the parser tries aren't subcommands.
 */
export class NoSubcommand {
  readonly command = null;

  /**
   * `prefixOf` are the commands `token` is a prefix of a name of, where
   * prefixes match. There is never exactly one of them.
   */
  constructor(
    private readonly subcommands: readonly Subcommand[],
    private readonly token: string,
    private readonly prefixOf: readonly Subcommand[],
  ) {}

  /** Why the token names none of the subcommands, as an error message and suggestions. */
  reason(): { message: string; didYouMean?: DidYouMean } {
    const token = this.token;
    if (token === "") {
      return { message: "Expected a command, but the value was empty" };
    }
    if (this.prefixOf.length > 0) {
      const possible = this.prefixOf.flatMap((command) =>
        asArray(command.name).filter((name) => name.startsWith(token)),
      );
      return { message: `Ambiguous command '${token}', could be: ${possible.join(", ")}` };
    }
    const choices = visibleSubcommands(this.subcommands).map((command) => asArray(command.name));
    return { message: `Unknown command '${token}'`, didYouMean: { input: token, choices } };
  }
}

/** The subcommands that help, completion and suggestions show. */
export function visibleSubcommands(subcommands: readonly Subcommand[] | undefined): Subcommand[] {
  return subcommands?.filter((subcommand) => !subcommand.hidden) ?? [];
}

/** The action of a command that has none of its own: print the command's help. */
export const usage: Action = ({ help }) => {
  print(help());
  return 0;
};
