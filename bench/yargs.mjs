import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";

await yargs(hideBin(process.argv))
  .scriptName("forge")
  .usage("$0 <command>\n\nBuild orchestrator.")
  .strict()
  .recommendCommands()
  .command(
    ["build [inputs..]", "b [inputs..]"],
    "Build inputs.",
    (cmd) =>
      cmd
        .positional("inputs", { type: "string", array: true })
        .option("out", { describe: "Output directory.", type: "string", demandOption: true })
        .option("mode", { describe: "Build mode.", type: "string" })
        .option("watch", { describe: "Watch files.", type: "boolean" })
        .option("verbose", { alias: "v", type: "count", describe: "Increase verbosity." }),
    (argv) => {
      console.log(
        `build:${(argv.inputs ?? []).join(",")}:${argv.out}:${argv.mode ?? "-"}:${Boolean(
          argv.watch,
        )}:${argv.verbose}`,
      );
    },
  )
  .command("remote <command>", "Manage remotes.", (cmd) =>
    cmd
      .command(
        "add <name> <url>",
        "Add a remote.",
        (sub) =>
          sub
            .positional("name", { type: "string" })
            .positional("url", { type: "string" })
            .option("force", { describe: "Overwrite an existing remote.", type: "boolean" })
            .option("tag", { describe: "Attach a tag.", type: "string" })
            .alias("tag", "t"),
        (argv) => {
          console.log(`add:${argv.name}:${argv.url}:${Boolean(argv.force)}:${argv.tag ?? "-"}`);
        },
      )
      .command(
        "remove <name>",
        "Remove a remote.",
        (sub) =>
          sub
            .positional("name", { type: "string" })
            .option("force", { describe: "Skip confirmation.", type: "boolean" }),
        (argv) => {
          console.log(`remove:${argv.name}`);
        },
      )
      .command(
        "list",
        "List remotes.",
        () => {},
        () => {
          console.log("list");
        },
      )
      .demandCommand(),
  )
  .command("config <command>", "Manage configuration.", (cmd) =>
    cmd
      .command(
        "set <key> <value>",
        "Set a value.",
        (sub) => sub.positional("key", { type: "string" }).positional("value", { type: "string" }),
        (argv) => {
          console.log(`set:${argv.key}:${argv.value}`);
        },
      )
      .command(
        "get <key>",
        "Get a value.",
        (sub) => sub.positional("key", { type: "string" }),
        (argv) => {
          console.log(`get:${argv.key}`);
        },
      )
      .demandCommand(),
  )
  .demandCommand()
  .parseAsync();
