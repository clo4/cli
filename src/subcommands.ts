import type { Action, Subcommand } from "./types.js";
import type { DidYouMean } from "./errors.js";
import type { LiveSubcommand } from "./scope.js";
import { asArray, print } from "./util.js";

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
    private readonly subcommands: readonly LiveSubcommand[],
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
    const choices = this.subcommands.filter(({ command }) => !command.hidden).map(({ names }) => names);
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
