import { parseArgs } from "node:util";

// Node's built-in flag parser with hand-written dispatch and help. It's the
// least a CLI can do for these scenarios, so it shows what the libraries'
// features cost on top.
const commands = {
  build: {
    usage: "forge build [options] [inputs...]",
    description: "Build inputs.",
    options: {
      out: { type: "string", description: "Output directory.", value: "<dir>" },
      mode: { type: "string", description: "Build mode.", value: "<mode>" },
      watch: { type: "boolean", description: "Watch files." },
      verbose: { type: "boolean", short: "v", multiple: true, description: "Increase verbosity." },
    },
    run({ values, positionals }) {
      if (values.out === undefined) {
        throw new Error("missing required option --out");
      }
      console.log(
        `build:${positionals.join(",")}:${values.out}:${values.mode ?? "-"}:${Boolean(values.watch)}:${
          values.verbose?.length ?? 0
        }`,
      );
    },
  },
  "remote add": {
    usage: "forge remote add [options] <name> <url>",
    description: "Add a remote.",
    positionals: 2,
    options: {
      force: { type: "boolean", description: "Overwrite an existing remote." },
      tag: { type: "string", short: "t", description: "Attach a tag.", value: "<tag>" },
    },
    run({ values, positionals: [name, url] }) {
      console.log(`add:${name}:${url}:${Boolean(values.force)}:${values.tag ?? "-"}`);
    },
  },
  "remote remove": {
    usage: "forge remote remove [options] <name>",
    description: "Remove a remote.",
    positionals: 1,
    options: { force: { type: "boolean", description: "Skip confirmation." } },
    run({ positionals: [name] }) {
      console.log(`remove:${name}`);
    },
  },
  "remote list": {
    usage: "forge remote list",
    description: "List remotes.",
    positionals: 0,
    options: {},
    run() {
      console.log("list");
    },
  },
  "config set": {
    usage: "forge config set <key> <value>",
    description: "Set a value.",
    positionals: 2,
    options: {},
    run({ positionals: [key, value] }) {
      console.log(`set:${key}:${value}`);
    },
  },
  "config get": {
    usage: "forge config get <key>",
    description: "Get a value.",
    positionals: 1,
    options: {},
    run({ positionals: [key] }) {
      console.log(`get:${key}`);
    },
  },
};

const aliases = { b: "build" };
const groups = { remote: "Manage remotes.", config: "Manage configuration." };

function rootHelp() {
  return [
    "Build orchestrator.",
    "",
    "Usage: forge <command> [options]",
    "",
    "Commands:",
    "  build, b  Build inputs.",
    ...Object.entries(groups).map(([name, description]) => `  ${name.padEnd(8)}  ${description}`),
    "",
    "Options:",
    "  -h, --help  Print help.",
  ].join("\n");
}

function groupHelp(group) {
  const lines = [groups[group], "", `Usage: forge ${group} <command>`, "", "Commands:"];
  for (const [name, command] of Object.entries(commands)) {
    if (name.startsWith(`${group} `)) {
      lines.push(`  ${name.slice(group.length + 1).padEnd(6)}  ${command.description}`);
    }
  }
  return lines.join("\n");
}

function commandHelp(command) {
  const rows = Object.entries(command.options).map(([name, option]) => {
    const flag = `${option.short ? `-${option.short}, ` : ""}--${name}${option.value ? ` ${option.value}` : ""}`;
    return [flag, option.description];
  });
  rows.push(["-h, --help", "Print help."]);
  const width = Math.max(...rows.map(([flag]) => flag.length));
  return [
    command.description,
    "",
    `Usage: ${command.usage}`,
    "",
    "Options:",
    ...rows.map(([flag, description]) => `  ${flag.padEnd(width)}  ${description}`),
  ].join("\n");
}

function main(argv) {
  let [first, second] = argv;
  first = aliases[first] ?? first;
  if (first === undefined || first === "-h" || first === "--help") {
    console.log(rootHelp());
    return first === undefined ? 1 : 0;
  }
  if (first in groups && (second === undefined || second === "-h" || second === "--help")) {
    console.log(groupHelp(first));
    return second === undefined ? 1 : 0;
  }

  const name = first in groups ? `${first} ${second}` : first;
  const command = commands[name];
  if (command === undefined) {
    throw new Error(`unknown command '${name}'`);
  }

  const { values, positionals } = parseArgs({
    args: argv.slice(name.split(" ").length),
    options: { ...command.options, help: { type: "boolean", short: "h" } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(commandHelp(command));
    return 0;
  }
  if (command.positionals !== undefined && positionals.length !== command.positionals) {
    throw new Error(`expected ${command.positionals} arguments, got ${positionals.length}`);
  }
  command.run({ values, positionals });
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
