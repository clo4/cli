import { cli } from "gunshi";
import { renderHeader } from "gunshi/renderer";

// gunshi has no command aliases, so `b` is registered as a second command, and
// help lists both. Its global options give -v to --version, and a command's own
// args override the global ones, so build moves --version to -V to free -v. A
// repeatable boolean collects one value per -v. gunshi's header is printed only
// with help, which is where its docs show it; by default gunshi 0.37 prints it
// before every command's output too. gunshi prints errors itself and then
// throws them, so the throw is caught to set the exit code without a second,
// uncaught report.
const build = {
  name: "build",
  description: "Build inputs.",
  args: {
    inputs: { type: "positional", multiple: true, required: false, description: "Inputs." },
    out: { type: "string", required: true, description: "Output directory." },
    mode: { type: "string", description: "Build mode." },
    watch: { type: "boolean", description: "Watch files." },
    verbose: { type: "boolean", short: "v", multiple: true, description: "Increase verbosity." },
    version: { type: "boolean", short: "V", description: "Display this version." },
  },
  run({ values }) {
    const verbose = [values.verbose ?? []].flat().filter(Boolean).length;
    console.log(
      `build:${(values.inputs ?? []).join(",")}:${values.out}:${values.mode ?? "-"}:${Boolean(values.watch)}:${verbose}`,
    );
  },
};

const remote = {
  name: "remote",
  description: "Manage remotes.",
  subCommands: {
    add: {
      name: "add",
      description: "Add a remote.",
      args: {
        name: { type: "positional", description: "Remote name." },
        url: { type: "positional", description: "Remote URL." },
        force: { type: "boolean", description: "Overwrite an existing remote." },
        tag: { type: "string", short: "t", description: "Attach a tag." },
      },
      run({ values }) {
        console.log(`add:${values.name}:${values.url}:${Boolean(values.force)}:${values.tag ?? "-"}`);
      },
    },
    remove: {
      name: "remove",
      description: "Remove a remote.",
      args: {
        name: { type: "positional", description: "Remote name." },
        force: { type: "boolean", description: "Skip confirmation." },
      },
      run({ values }) {
        console.log(`remove:${values.name}`);
      },
    },
    list: {
      name: "list",
      description: "List remotes.",
      run() {
        console.log("list");
      },
    },
  },
};

const config = {
  name: "config",
  description: "Manage configuration.",
  subCommands: {
    set: {
      name: "set",
      description: "Set a value.",
      args: {
        key: { type: "positional", description: "Key." },
        value: { type: "positional", description: "Value." },
      },
      run({ values }) {
        console.log(`set:${values.key}:${values.value}`);
      },
    },
    get: {
      name: "get",
      description: "Get a value.",
      args: { key: { type: "positional", description: "Key." } },
      run({ values }) {
        console.log(`get:${values.key}`);
      },
    },
  },
};

try {
  await cli(
    process.argv.slice(2),
    { name: "forge", description: "Build orchestrator." },
    {
      name: "forge",
      description: "Build orchestrator.",
      strict: true,
      renderHeader: (ctx) => (ctx.values.help ? renderHeader(ctx) : ""),
      subCommands: { build, b: { ...build, name: "b" }, remote, config },
    },
  );
} catch {
  process.exitCode = 1;
}
