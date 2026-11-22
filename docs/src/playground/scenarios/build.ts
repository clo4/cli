import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "demo",
  description: "A small build tool",
  options: [CLI.help],
  subcommands: [
    {
      name: "build",
      description: "Build a project",
      args: {
        name: "input",
        description: "Source directory",
        isOptional: true,
        default: ".",
      },
      options: [
        {
          name: ["-w", "--watch"],
          description: "Watch for changes",
        },
        {
          name: ["-o", "--output"],
          description: "Output directory",
          args: {
            name: "dir",
            default: "dist",
          },
        },
        {
          name: ["-j", "--jobs"],
          description: "Tasks to run at once",
          args: {
            name: "count",
            default: "4",
            parse: CLI.number({
              min: 1,
              max: 64,
              int: true,
            }),
          },
        },
      ],
    },
    CLI.helpCommand,
    CLI.completion,
  ],
});
