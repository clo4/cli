import { completion, help, run } from "../dist/index.js";

// A richer, realistic CLI shared (equivalently) across every adapter so the
// benchmark exercises deep nesting, variadic args, aliases, repeatable options,
// required options, and multiple command groups — not a toy two-command spec.
const spec = {
  name: "forge",
  description: "Build orchestrator.",
  options: [help],
  subcommands: [
    {
      name: ["build", "b"],
      description: "Build inputs.",
      args: { name: "inputs", isVariadic: true },
      options: [
        {
          name: "--out",
          description: "Output directory.",
          args: { name: "dir" },
          isRequired: true,
        },
        { name: "--mode", description: "Build mode.", args: { name: "mode" } },
        { name: "--watch", description: "Watch files." },
        { name: ["-v", "--verbose"], description: "Increase verbosity.", isRepeatable: true },
      ],
      action({ args, options }) {
        console.log(
          `build:${args.join(",")}:${options.get("--out")}:${options.get("--mode") ?? "-"}:${options.has(
            "--watch",
          )}:${options.count("-v")}`,
        );
      },
    },
    {
      name: "remote",
      description: "Manage remotes.",
      requiresSubcommand: true,
      subcommands: [
        {
          name: "add",
          description: "Add a remote.",
          args: [{ name: "name" }, { name: "url" }],
          options: [
            { name: "--force", description: "Overwrite an existing remote." },
            { name: ["-t", "--tag"], description: "Attach a tag.", args: { name: "tag" } },
          ],
          action({ args, options }) {
            console.log(`add:${args[0]}:${args[1]}:${options.has("--force")}:${options.get("--tag") ?? "-"}`);
          },
        },
        {
          name: "remove",
          description: "Remove a remote.",
          args: { name: "name" },
          options: [{ name: "--force", description: "Skip confirmation." }],
          action({ args }) {
            console.log(`remove:${args[0]}`);
          },
        },
        {
          name: "list",
          description: "List remotes.",
          action() {
            console.log("list");
          },
        },
      ],
    },
    {
      name: "config",
      description: "Manage configuration.",
      requiresSubcommand: true,
      subcommands: [
        {
          name: "set",
          description: "Set a value.",
          args: [{ name: "key" }, { name: "value" }],
          action({ args }) {
            console.log(`set:${args[0]}:${args[1]}`);
          },
        },
        {
          name: "get",
          description: "Get a value.",
          args: { name: "key" },
          action({ args }) {
            console.log(`get:${args[0]}`);
          },
        },
      ],
    },
    // Only @clo4/cli has runtime completion, so it's measured on its own.
    // Hidden, so the help scenarios print the same help as the other adapters.
    { ...completion, hidden: true },
  ],
};

process.exitCode = await run(spec);
