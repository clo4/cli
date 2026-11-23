import * as CLI from "@clo4/cli";

export default CLI.command({
  name: "remote",
  requiresSubcommand: true,
  subcommands: [
    {
      name: "add",
      description: "Add a remote",
      args: {
        name: "url",
        description: "Where the remote is",
      },
      options: [
        {
          name: ["-f", "--fetch"],
          description: "Fetch it once it's added",
        },
      ],
      action({ args: [url], options }) {
        console.log(`Added ${url}`);
        if (options.has("--fetch")) {
          console.log("Fetching...");
        }
      },
    },
    {
      name: "list",
      description: "List remotes",
      action() {
        console.log("No remotes configured.");
      },
    },
  ],
});
