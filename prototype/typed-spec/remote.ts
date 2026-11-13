import { command } from "./lib.ts";
export default command({
  requiresSubcommand: true,
  subcommands: [
    {
      name: "add",
      description: "Add a remote.",
      args: { name: "url" },
      options: [{ name: "--fetch" }],
      action({ args: [url], options }) {
        url satisfies string;
        options.has("--fetch");
      },
    },
    { name: "list", action() {} },
  ],
});
