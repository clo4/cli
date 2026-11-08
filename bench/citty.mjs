import { defineCommand, runMain } from "citty";

// citty has no variadic positionals, repeatable flags or unknown-option errors.
// The inputs come from `args._`, and the verbosity count is read from the raw
// arguments, which is how a citty CLI would have to do it. citty ignores the
// unknown `--uot` in the unknown-option scenario and runs the build.
const build = defineCommand({
  meta: { name: "build", alias: "b", description: "Build inputs." },
  args: {
    out: { type: "string", description: "Output directory.", valueHint: "dir", required: true },
    mode: { type: "string", description: "Build mode.", valueHint: "mode" },
    watch: { type: "boolean", description: "Watch files." },
    verbose: { type: "boolean", alias: "v", description: "Increase verbosity." },
  },
  run({ args, rawArgs }) {
    let verbose = 0;
    for (let i = 0; i < rawArgs.length; i += 1) {
      const arg = rawArgs[i];
      if (arg === "--") {
        break;
      } else if (arg === "--out" || arg === "--mode") {
        i += 1;
      } else if (arg === "--verbose") {
        verbose += 1;
      } else if (/^-[a-z]+$/i.test(arg)) {
        verbose += arg.split("v").length - 1;
      }
    }
    console.log(
      `build:${args._.join(",")}:${args.out}:${args.mode ?? "-"}:${Boolean(args.watch)}:${verbose}`,
    );
  },
});

const remote = defineCommand({
  meta: { name: "remote", description: "Manage remotes." },
  subCommands: {
    add: defineCommand({
      meta: { name: "add", description: "Add a remote." },
      args: {
        name: { type: "positional", required: true },
        url: { type: "positional", required: true },
        force: { type: "boolean", description: "Overwrite an existing remote." },
        tag: { type: "string", alias: "t", description: "Attach a tag.", valueHint: "tag" },
      },
      run({ args }) {
        console.log(`add:${args.name}:${args.url}:${Boolean(args.force)}:${args.tag ?? "-"}`);
      },
    }),
    remove: defineCommand({
      meta: { name: "remove", description: "Remove a remote." },
      args: {
        name: { type: "positional", required: true },
        force: { type: "boolean", description: "Skip confirmation." },
      },
      run({ args }) {
        console.log(`remove:${args.name}`);
      },
    }),
    list: defineCommand({
      meta: { name: "list", description: "List remotes." },
      run() {
        console.log("list");
      },
    }),
  },
});

const config = defineCommand({
  meta: { name: "config", description: "Manage configuration." },
  subCommands: {
    set: defineCommand({
      meta: { name: "set", description: "Set a value." },
      args: {
        key: { type: "positional", required: true },
        value: { type: "positional", required: true },
      },
      run({ args }) {
        console.log(`set:${args.key}:${args.value}`);
      },
    }),
    get: defineCommand({
      meta: { name: "get", description: "Get a value." },
      args: { key: { type: "positional", required: true } },
      run({ args }) {
        console.log(`get:${args.key}`);
      },
    }),
  },
});

await runMain(
  defineCommand({
    meta: { name: "forge", description: "Build orchestrator." },
    subCommands: { build, remote, config },
  }),
);
