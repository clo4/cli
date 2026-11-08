import {
  array,
  boolean,
  command,
  flag,
  multiflag,
  option,
  optional,
  positional,
  restPositionals,
  run,
  string,
  subcommands,
} from "cmd-ts";

// cmd-ts nests groups with subcommands(). The -v counter is a multiflag, which
// collects one value per occurrence.
const build = command({
  name: "build",
  aliases: ["b"],
  description: "Build inputs.",
  args: {
    inputs: restPositionals({ type: string, displayName: "inputs" }),
    out: option({ long: "out", type: string, description: "Output directory." }),
    mode: option({ long: "mode", type: optional(string), description: "Build mode." }),
    watch: flag({ long: "watch", type: boolean, description: "Watch files." }),
    verbose: multiflag({
      long: "verbose",
      short: "v",
      type: array(boolean),
      description: "Increase verbosity.",
    }),
  },
  handler({ inputs, out, mode, watch, verbose }) {
    console.log(`build:${inputs.join(",")}:${out}:${mode ?? "-"}:${watch}:${verbose.filter(Boolean).length}`);
  },
});

const remote = subcommands({
  name: "remote",
  description: "Manage remotes.",
  cmds: {
    add: command({
      name: "add",
      description: "Add a remote.",
      args: {
        name: positional({ type: string, displayName: "name" }),
        url: positional({ type: string, displayName: "url" }),
        force: flag({ long: "force", type: boolean, description: "Overwrite an existing remote." }),
        tag: option({ long: "tag", short: "t", type: optional(string), description: "Attach a tag." }),
      },
      handler({ name, url, force, tag }) {
        console.log(`add:${name}:${url}:${force}:${tag ?? "-"}`);
      },
    }),
    remove: command({
      name: "remove",
      description: "Remove a remote.",
      args: {
        name: positional({ type: string, displayName: "name" }),
        force: flag({ long: "force", type: boolean, description: "Skip confirmation." }),
      },
      handler({ name }) {
        console.log(`remove:${name}`);
      },
    }),
    list: command({
      name: "list",
      description: "List remotes.",
      args: {},
      handler() {
        console.log("list");
      },
    }),
  },
});

const config = subcommands({
  name: "config",
  description: "Manage configuration.",
  cmds: {
    set: command({
      name: "set",
      description: "Set a value.",
      args: {
        key: positional({ type: string, displayName: "key" }),
        value: positional({ type: string, displayName: "value" }),
      },
      handler({ key, value }) {
        console.log(`set:${key}:${value}`);
      },
    }),
    get: command({
      name: "get",
      description: "Get a value.",
      args: { key: positional({ type: string, displayName: "key" }) },
      handler({ key }) {
        console.log(`get:${key}`);
      },
    }),
  },
});

await run(
  subcommands({ name: "forge", description: "Build orchestrator.", cmds: { build, remote, config } }),
  process.argv.slice(2),
);
