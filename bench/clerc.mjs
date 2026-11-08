import { Cli, friendlyErrorPlugin, notFoundPlugin, strictFlagsPlugin } from "clerc";

// Cli() comes with clerc's help and version plugins, which fail unless the CLI
// has a name and a version. Rejecting unknown options,
// suggesting commands and printing errors without a stack trace are separate
// plugins in clerc, so the adapter adds those three, as a clerc CLI with the
// same behavior as the other adapters would. Groups are multi-word command
// names, and the -v counter is a [Boolean] flag.
await Cli()
  .scriptName("forge")
  .name("forge")
  .version("0.0.0")
  .description("Build orchestrator.")
  .use(strictFlagsPlugin())
  .use(notFoundPlugin())
  .use(friendlyErrorPlugin())
  .command("build", "Build inputs.", {
    alias: "b",
    parameters: ["[inputs...]"],
    flags: {
      out: { type: String, required: true, description: "Output directory." },
      mode: { type: String, description: "Build mode." },
      watch: { type: Boolean, description: "Watch files." },
      verbose: { type: [Boolean], short: "v", description: "Increase verbosity." },
    },
  })
  .on("build", ({ parameters, flags }) => {
    console.log(
      `build:${parameters.inputs.join(",")}:${flags.out}:${flags.mode ?? "-"}:${Boolean(flags.watch)}:${flags.verbose}`,
    );
  })
  .command("remote add", "Add a remote.", {
    parameters: ["<name>", "<url>"],
    flags: {
      force: { type: Boolean, description: "Overwrite an existing remote." },
      tag: { type: String, short: "t", description: "Attach a tag." },
    },
  })
  .on("remote add", ({ parameters, flags }) => {
    console.log(`add:${parameters.name}:${parameters.url}:${Boolean(flags.force)}:${flags.tag ?? "-"}`);
  })
  .command("remote remove", "Remove a remote.", {
    parameters: ["<name>"],
    flags: { force: { type: Boolean, description: "Skip confirmation." } },
  })
  .on("remote remove", ({ parameters }) => {
    console.log(`remove:${parameters.name}`);
  })
  .command("remote list", "List remotes.")
  .on("remote list", () => {
    console.log("list");
  })
  .command("config set", "Set a value.", { parameters: ["<key>", "<value>"] })
  .on("config set", ({ parameters }) => {
    console.log(`set:${parameters.key}:${parameters.value}`);
  })
  .command("config get", "Get a value.", { parameters: ["<key>"] })
  .on("config get", ({ parameters }) => {
    console.log(`get:${parameters.key}`);
  })
  .parse();
