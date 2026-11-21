import type { Subcommand } from "./types.js";

export type { Shell } from "./completion-command.js";

/**
 * Subcommand that prints an installation script for the requested shell.
 * Without an argument, list supported shells. Add it to the root's `subcommands`.
 *
 * Generate and load the script at shell startup. The script and its internal
 * completion protocol can change between releases.
 *
 * Each completion request starts a new CLI process. Scripts set
 * `SHELL_COMPLETION_GENERATOR` to the shell name. Completion calls argument
 * generators without running the selected command's action.
 *
 * Its `loadSpec` imports the command, so a run that doesn't complete or print
 * a script never loads the code that does.
 */
export const completion: Subcommand = {
  name: "completion",
  description: "Print a shell completion script",
  loadSpec: () => import("./completion-command.js").then((module) => module.default),
};
