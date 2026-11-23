import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "demo",
  description: "Keep track of remotes and settings",
  options: [CLI.help],
  subcommands: [
    {
      name: "remote",
      description: "Manage remotes",
      loadSpec: () => import("./remote.ts").then((module) => module.default),
    },
    {
      name: "config",
      description: "Read and change settings",
      loadSpec: () => import("./config.ts").then((module) => module.default),
    },
    CLI.helpCommand,
    CLI.completion,
  ],
});
