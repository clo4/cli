import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "serve",
  description: "Serve a folder",
  args: {
    name: "root",
    description: "Folder to serve",
  },
  options: [
    CLI.help,
    {
      name: "--port",
      description: "Listen on this port",
      args: {
        name: "port",
        default: "8080",
        parse: CLI.number({
          min: 1,
          max: 65535,
          int: true,
        }),
      },
    },
    {
      name: "--mode",
      description: "Build mode",
      isRequired: true,
      args: {
        name: "mode",
        parse: CLI.choice("debug", "release"),
      },
    },
  ],
  subcommands: [CLI.completion],
  action({ args: [root], options }) {
    console.log(`Serving ${root} on port ${options.get("--port")} in ${options.get("--mode")} mode`);
  },
});
