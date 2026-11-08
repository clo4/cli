import { boolean, command, positional, run, string } from "@drizzle-team/brocli";

// brocli has no variadic positionals or repeatable flags, rejects positionals
// it doesn't expect, and reserves -v for --version. So for build, the adapter
// takes the inputs and the -v/--verbose count out of the arguments before
// brocli parses them, and passes brocli one --verbose so the flag still shows
// in help and is still validated.
const args = process.argv.slice(2);
const inputs = [];
let verbose = 0;
if (args[0] === "build" || args[0] === "b") {
  const rest = [args[0]];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      inputs.push(...args.slice(i + 1));
      break;
    } else if (arg === "--out" || arg === "--mode") {
      rest.push(arg, args[(i += 1)]);
    } else if (arg === "--verbose" || /^-v+$/.test(arg)) {
      verbose += arg === "--verbose" ? 1 : arg.length - 1;
    } else if (arg.startsWith("-")) {
      rest.push(arg);
    } else {
      inputs.push(arg);
    }
  }
  if (verbose > 0) {
    rest.push("--verbose");
  }
  args.splice(0, args.length, ...rest);
}

const build = command({
  name: "build",
  aliases: ["b"],
  desc: "Build inputs.",
  options: {
    out: string().required().desc("Output directory."),
    mode: string().desc("Build mode."),
    watch: boolean().desc("Watch files."),
    verbose: boolean().desc("Increase verbosity."),
  },
  handler({ out, mode, watch }) {
    console.log(`build:${inputs.join(",")}:${out}:${mode ?? "-"}:${Boolean(watch)}:${verbose}`);
  },
});

const remote = command({
  name: "remote",
  desc: "Manage remotes.",
  subcommands: [
    command({
      name: "add",
      desc: "Add a remote.",
      options: {
        name: positional().required(),
        url: positional().required(),
        force: boolean().desc("Overwrite an existing remote."),
        tag: string().alias("t").desc("Attach a tag."),
      },
      handler({ name, url, force, tag }) {
        console.log(`add:${name}:${url}:${Boolean(force)}:${tag ?? "-"}`);
      },
    }),
    command({
      name: "remove",
      desc: "Remove a remote.",
      options: {
        name: positional().required(),
        force: boolean().desc("Skip confirmation."),
      },
      handler({ name }) {
        console.log(`remove:${name}`);
      },
    }),
    command({
      name: "list",
      desc: "List remotes.",
      handler() {
        console.log("list");
      },
    }),
  ],
});

const config = command({
  name: "config",
  desc: "Manage configuration.",
  subcommands: [
    command({
      name: "set",
      desc: "Set a value.",
      options: { key: positional().required(), value: positional().required() },
      handler({ key, value }) {
        console.log(`set:${key}:${value}`);
      },
    }),
    command({
      name: "get",
      desc: "Get a value.",
      options: { key: positional().required() },
      handler({ key }) {
        console.log(`get:${key}`);
      },
    }),
  ],
});

await run([build, remote, config], {
  name: "forge",
  description: "Build orchestrator.",
  argSource: [process.argv[0], process.argv[1], ...args],
});
