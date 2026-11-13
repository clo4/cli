import { command } from "../../src/index.js";

/** A command in a file of its own, for a `loadSpec` to import. */
export default command({
  name: "remote",
  requiresSubcommand: true,
  subcommands: [
    {
      name: "add",
      description: "Add a remote.",
      args: { name: "url" },
      options: [{ name: "--fetch", description: "Fetch after adding." }],
      action({ args: [url], options }) {
        url satisfies string;
        return options.has("--fetch") ? 0 : 1;
      },
    },
    { name: "list", description: "List remotes.", action: () => 0 },
  ],
});
