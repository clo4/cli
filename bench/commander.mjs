import { startTiming } from "./_timing.mjs";

startTiming();
const { Command } = await import("commander");

const program = new Command();

program.name("forge").description("Build orchestrator.").showSuggestionAfterError().exitOverride();

program
  .command("build [inputs...]")
  .alias("b")
  .description("Build inputs.")
  .requiredOption("--out <dir>", "Output directory.")
  .option("--mode <mode>", "Build mode.")
  .option("--watch", "Watch files.")
  .option("-v, --verbose", "Increase verbosity.", (_, previous) => previous + 1, 0)
  .action((inputs, options) => {
    console.log(
      `build:${inputs.join(",")}:${options.out}:${options.mode ?? "-"}:${Boolean(
        options.watch,
      )}:${options.verbose}`,
    );
  });

const remote = program.command("remote").description("Manage remotes.");

remote
  .command("add <name> <url>")
  .description("Add a remote.")
  .option("--force", "Overwrite an existing remote.")
  .option("-t, --tag <tag>", "Attach a tag.")
  .action((name, url, options) => {
    console.log(`add:${name}:${url}:${Boolean(options.force)}:${options.tag ?? "-"}`);
  });

remote
  .command("remove <name>")
  .description("Remove a remote.")
  .option("--force", "Skip confirmation.")
  .action((name) => {
    console.log(`remove:${name}`);
  });

remote
  .command("list")
  .description("List remotes.")
  .action(() => {
    console.log("list");
  });

const config = program.command("config").description("Manage configuration.");

config
  .command("set <key> <value>")
  .description("Set a value.")
  .action((key, value) => {
    console.log(`set:${key}:${value}`);
  });

config
  .command("get <key>")
  .description("Get a value.")
  .action((key) => {
    console.log(`get:${key}`);
  });

try {
  program.parse();
} catch (error) {
  process.exitCode = error.exitCode ?? 1;
}
