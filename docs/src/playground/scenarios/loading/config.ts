import * as CLI from "@clo4/cli";

export default CLI.command({
  name: "config",
  requiresSubcommand: true,
  subcommands: [
    {
      name: "get",
      description: "Print a setting",
      args: {
        name: "key",
        suggestions: ["user.name", "user.email"],
      },
      action({ args: [key] }) {
        console.log(`${key} isn't set`);
      },
    },
    {
      name: "set",
      description: "Change a setting",
      args: [
        {
          name: "key",
          suggestions: ["user.name", "user.email"],
        },
        { name: "value" },
      ],
      action({ args: [key, value] }) {
        console.log(`Set ${key} to ${value}`);
      },
    },
  ],
});
