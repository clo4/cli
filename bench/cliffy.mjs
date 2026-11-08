import { Command } from "@cliffy/command";

const remote = new Command()
  .description("Manage remotes.")
  .command("add <name:string> <url:string>", "Add a remote.")
  .option("--force", "Overwrite an existing remote.")
  .option("-t, --tag <tag:string>", "Attach a tag.")
  .action(({ force, tag }, name, url) => {
    console.log(`add:${name}:${url}:${Boolean(force)}:${tag ?? "-"}`);
  })
  .command("remove <name:string>", "Remove a remote.")
  .option("--force", "Skip confirmation.")
  .action((_options, name) => {
    console.log(`remove:${name}`);
  })
  .command("list", "List remotes.")
  .action(() => {
    console.log("list");
  });

const config = new Command()
  .description("Manage configuration.")
  .command("set <key:string> <value:string>", "Set a value.")
  .action((_options, key, value) => {
    console.log(`set:${key}:${value}`);
  })
  .command("get <key:string>", "Get a value.")
  .action((_options, key) => {
    console.log(`get:${key}`);
  });

await new Command()
  .name("forge")
  .description("Build orchestrator.")
  .command("build [...inputs:string]", "Build inputs.")
  .alias("b")
  .option("--out <dir:string>", "Output directory.", { required: true })
  .option("--mode <mode:string>", "Build mode.")
  .option("--watch", "Watch files.")
  .option("-v, --verbose", "Increase verbosity.", {
    collect: true,
    value: (_value, previous = 0) => previous + 1,
  })
  .action(({ out, mode, watch, verbose }, ...inputs) => {
    console.log(`build:${inputs.join(",")}:${out}:${mode ?? "-"}:${Boolean(watch)}:${verbose ?? 0}`);
  })
  .command("remote", remote)
  .command("config", config)
  .parse(process.argv.slice(2));
