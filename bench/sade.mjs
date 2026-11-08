import sade from "sade";

const prog = sade("forge").describe("Build orchestrator.");

// sade passes one argument per declared positional and puts the rest in
// `options._`, so the variadic inputs are the first input plus `options._`.
// It has no required options, so `--out` is checked in the action.
prog
  .command("build [input]", "Build inputs.", { alias: "b" })
  .option("--out", "Output directory.")
  .option("--mode", "Build mode.")
  .option("--watch", "Watch files.")
  .option("-v, --verbose", "Increase verbosity.")
  .action((input, options) => {
    if (typeof options.out !== "string") {
      console.error("ERROR\n  Missing required option: --out");
      process.exitCode = 1;
      return;
    }
    const inputs = input === undefined ? [] : [input, ...options._];
    const verbose = [options.verbose ?? []].flat().filter(Boolean).length;
    console.log(
      `build:${inputs.join(",")}:${options.out}:${options.mode ?? "-"}:${Boolean(options.watch)}:${verbose}`,
    );
  });

prog.command("remote", "Manage remotes.").action(() => {
  prog.help("remote");
  process.exitCode = 1;
});

prog
  .command("remote add <name> <url>", "Add a remote.")
  .option("--force", "Overwrite an existing remote.")
  .option("-t, --tag", "Attach a tag.")
  .action((name, url, options) => {
    console.log(`add:${name}:${url}:${Boolean(options.force)}:${options.tag ?? "-"}`);
  });

prog
  .command("remote remove <name>", "Remove a remote.")
  .option("--force", "Skip confirmation.")
  .action((name) => {
    console.log(`remove:${name}`);
  });

prog.command("remote list", "List remotes.").action(() => {
  console.log("list");
});

prog.command("config", "Manage configuration.").action(() => {
  prog.help("config");
  process.exitCode = 1;
});

prog.command("config set <key> <value>", "Set a value.").action((key, value) => {
  console.log(`set:${key}:${value}`);
});

prog.command("config get <key>", "Get a value.").action((key) => {
  console.log(`get:${key}`);
});

// sade always treats `-v` as `--version`, so a sade CLI that wants `-v` for
// verbosity has to rewrite it before parsing.
const argv = [];
let afterSeparator = false;
for (const arg of process.argv) {
  afterSeparator ||= arg === "--";
  if (!afterSeparator && /^-v+$/.test(arg)) {
    for (let i = 1; i < arg.length; i += 1) {
      argv.push("--verbose");
    }
  } else {
    argv.push(arg);
  }
}

prog.parse(argv, {
  boolean: ["watch", "verbose", "force"],
  unknown: (flag) => `Unknown option: ${flag}`,
});
