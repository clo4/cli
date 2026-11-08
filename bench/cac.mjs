import cac from "cac";

const cli = cac("forge");

cli
  .command("build [...inputs]", "Build inputs.", { allowUnknownOptions: false })
  .alias("b")
  .option("--out <dir>", "Output directory.")
  .option("--mode <mode>", "Build mode.")
  .option("--watch", "Watch files.")
  .option("-v, --verbose", "Increase verbosity.")
  .action((inputs, options) => {
    const verbose = Array.isArray(options.verbose)
      ? options.verbose.length
      : Number(Boolean(options.verbose));
    console.log(
      `build:${inputs.join(",")}:${options.out}:${options.mode ?? "-"}:${Boolean(options.watch)}:${verbose}`,
    );
  });

// cac has no native nested subcommands (multi-word command names do not
// dispatch), so command groups are modeled the idiomatic cac way: a leading
// action positional handled inside one command. Invocations stay identical to
// the other adapters (`forge remote add <name> <url>`).
cli
  .command("remote <action> [name] [url]", "Manage remotes.", { allowUnknownOptions: false })
  .option("--force", "Overwrite / skip confirmation.")
  .option("-t, --tag <tag>", "Attach a tag.")
  .action((action, name, url, options) => {
    if (action === "add") {
      console.log(`add:${name}:${url}:${Boolean(options.force)}:${options.tag ?? "-"}`);
    } else if (action === "remove") {
      console.log(`remove:${name}`);
    } else if (action === "list") {
      console.log("list");
    }
  });

cli
  .command("config <action> [key] [value]", "Manage configuration.", { allowUnknownOptions: false })
  .action((action, key, value) => {
    if (action === "set") {
      console.log(`set:${key}:${value}`);
    } else if (action === "get") {
      console.log(`get:${key}`);
    }
  });

cli.help();

// The error handling from Cac's README. Without it, Cac's errors are uncaught
// and Node prints them with a stack trace.
try {
  cli.parse(process.argv, { run: false });
  cli.runMatchedCommand();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
