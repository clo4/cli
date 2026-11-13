/**
 * Generated adapters for CLIs with many commands. Each CLI has `groups`
 * command groups of `commands` commands, and each command takes one argument
 * and `options` options that take a value. Running a command prints
 * `run:<group>:<command>:<argument>:<value of --o1>`. Every CLI prints help
 * for `--help` and for a group's `--help`, apart from sade, and an error for
 * an unknown command.
 *
 * Each library's CLI follows the form its own docs show:
 *
 * - `largeGenerators` write the CLI in one file. @clo4/cli puts each group's
 *   commands behind a `loadSpec`, and citty and Cliffy make each group a
 *   function, so running a command builds only its group. Yargs runs a
 *   group's builder only when a command line enters it. citty builds every
 *   group to print root help or report an unknown command, and Cliffy builds
 *   every group to print root help. The `parseArgs` CLI makes each group's
 *   commands a function too, as a careful hand-written CLI would. Commander,
 *   sade, Stricli and gunshi build every command when the CLI starts.
 * - `splitGenerators` write a file per group, which the entry imports when a
 *   command line needs it. Only the libraries whose docs show a way to load
 *   code from another file have one. Stricli and gunshi load only a command's
 *   action from the file. A hand-written `parseArgs` CLI can do the same
 *   with `import()`.
 * - `clo4WholeSpec` writes @clo4/cli's CLI without `loadSpec`, so the
 *   benchmark keeps a record of what building the whole spec costs.
 */

export interface LargeShape {
  groups: number;
  commands: number;
  options: number;
}

/**
 * A generated CLI. `files` holds the source of each file the entry imports
 * with `import()`, by the path it imports it from. It's empty for a CLI in
 * one file.
 */
export interface LargeCli {
  entry: string;
  files: ReadonlyMap<string, string>;
}

type Generate = (shape: LargeShape) => LargeCli;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** The path an entry imports group `g` from. */
const groupFile = (g: number): string => `./large-group-${g}.mjs`;

/** A generator for a CLI in one file. */
const oneFile =
  (generate: (shape: LargeShape) => string): Generate =>
  (shape) => ({ entry: generate(shape), files: new Map() });

/** A generator for a CLI with a file per group, from the entry and the source of group `g`'s file. */
const filePerGroup =
  (entry: (shape: LargeShape) => string, group: (g: number, shape: LargeShape) => string): Generate =>
  (shape) => ({
    entry: entry(shape),
    files: new Map(range(shape.groups).map((g) => [groupFile(g), group(g, shape)])),
  });

/** The command line that runs one command near the end of `shape`, and what it prints. */
export function largeCommandLine(shape: LargeShape): { args: string[]; stdout: string } {
  const group = `g${shape.groups - 3}`;
  const command = `c${shape.commands - 2}`;
  return { args: [group, command, "in", "--o1", "val"], stdout: `run:${group}:${command}:in:val\n` };
}

/** What a command prints when it runs, as a template literal's contents. */
const output = (g: number, c: number, input: string, o1: string): string =>
  `run:g${g}:c${c}:\${${input}}:\${${o1}}`;

// @clo4/cli

const clo4Command = (g: number, c: number, options: number): string =>
  `      { name: "c${c}", description: "Command ${g}.${c}.", args: { name: "input" },
        options: [${range(options)
          .map((o) => `{ name: "--o${o}", description: "Option ${o}.", args: { name: "v" } }`)
          .join(", ")}],
        action({ args, options }) { console.log(\`${output(g, c, "args[0]", 'options.get("--o1")')}\`); } },`;

/** The properties a @clo4/cli group has besides its name and description. */
const clo4GroupRest = (g: number, { commands, options }: LargeShape): string =>
  `requiresSubcommand: true, subcommands: [
${range(commands)
  .map((c) => clo4Command(g, c, options))
  .join("\n")}
    ]`;

/** The @clo4/cli CLI, with `group` writing each group after its name and description. */
const clo4Cli = (shape: LargeShape, group: (g: number) => string, before = ""): string => `
import * as CLI from "../dist/index.js";
${before}CLI.run(CLI.spec({
  name: "forge", description: "Big CLI.", options: [CLI.help],
  subcommands: [
${range(shape.groups)
  .map((g) => `    { name: "g${g}", description: "Group ${g}.", ${group(g)} },`)
  .join("\n")}
  ],
}));
`;

export const clo4WholeSpec: Generate = oneFile((shape) => clo4Cli(shape, (g) => clo4GroupRest(g, shape)));

/** A @clo4/cli group as the whole command a `loadSpec` gives, with its name again. */
const clo4LoadedGroup = (g: number, shape: LargeShape): string =>
  `CLI.command({ name: "g${g}", ${clo4GroupRest(g, shape)} })`;

/** README.md, "Loading commands on demand", returning the command from the same file. */
const clo4: Generate = oneFile((shape) =>
  clo4Cli(shape, (g) => `loadSpec: () => ${clo4LoadedGroup(g, shape)}`),
);

/** README.md, "Loading commands on demand", with `loadSpec` importing the group's file. */
const clo4Split: Generate = filePerGroup(
  (shape) =>
    clo4Cli(
      shape,
      (g) => `loadSpec: () => import("${groupFile(g)}").then(command)`,
      "const command = (module) => module.default;\n",
    ),
  (g, shape) => `import * as CLI from "../dist/index.js";\nexport default ${clo4LoadedGroup(g, shape)};`,
);

// sade

const sade: Generate = oneFile(
  ({ groups, commands, options }) => `
import sade from "sade";
const prog = sade("forge").describe("Big CLI.");
${range(groups)
  .flatMap((g) =>
    range(commands).map(
      (c) =>
        `prog.command("g${g} c${c} <input>", "Command ${g}.${c}.")${range(options)
          .map((o) => `.option("--o${o}", "Option ${o}.")`)
          .join("")}.action((input, o) => { console.log(\`${output(g, c, "input", "o.o1")}\`); });`,
    ),
  )
  .join("\n")}
prog.parse(process.argv, { unknown: (flag) => \`Unknown option: \${flag}\` });
`,
);

// Commander

const commander: Generate = oneFile(
  ({ groups, commands, options }) => `
import { Command } from "commander";
const program = new Command().name("forge").description("Big CLI.");
${range(groups)
  .map(
    (g) => `{
  const group = program.command("g${g}").description("Group ${g}.");
${range(commands)
  .map(
    (c) =>
      `  group.command("c${c} <input>").description("Command ${g}.${c}.")${range(options)
        .map((o) => `.option("--o${o} <v>", "Option ${o}.")`)
        .join("")}.action((input, o) => { console.log(\`${output(g, c, "input", "o.o1")}\`); });`,
  )
  .join("\n")}
}`,
  )
  .join("\n")}
program.parse();
`,
);

// citty

/** A citty group, as a call to `defineCommand`. */
const cittyGroup = (g: number, { commands, options }: LargeShape): string =>
  `defineCommand({ meta: { name: "g${g}", description: "Group ${g}." }, subCommands: {
${range(commands)
  .map(
    (c) => `    c${c}: () => defineCommand({ meta: { name: "c${c}", description: "Command ${g}.${c}." },
      args: { input: { type: "positional", required: true }, ${range(options)
        .map((o) => `o${o}: { type: "string", description: "Option ${o}." }`)
        .join(", ")} },
      run({ args }) { console.log(\`${output(g, c, "args.input", "args.o1")}\`); } }),`,
  )
  .join("\n")}
  } })`;

/** The citty CLI, with `group` writing each group's value in the root's `subCommands`. */
const cittyCli = (shape: LargeShape, group: (g: number) => string, before = ""): string => `
import { defineCommand, runMain } from "citty";
${before}await runMain(defineCommand({ meta: { name: "forge", description: "Big CLI." }, subCommands: {
${range(shape.groups)
  .map((g) => `  g${g}: ${group(g)},`)
  .join("\n")}
} }));
`;

/** citty's README, "Lazy Commands": `meta`, `args` and `subCommands` accept functions. */
const citty: Generate = oneFile((shape) => cittyCli(shape, (g) => `() => ${cittyGroup(g, shape)}`));

/** citty's README, "Lazy Commands", importing each group's file. */
const cittySplit: Generate = filePerGroup(
  (shape) =>
    cittyCli(
      shape,
      (g) => `() => import("${groupFile(g)}").then(body)`,
      "const body = (module) => module.default;\n",
    ),
  (g, shape) => `import { defineCommand } from "citty";\nexport default ${cittyGroup(g, shape)};`,
);

// Cliffy

/** A Cliffy group, as a `Command` with a subcommand for each command. */
const cliffyGroup = (g: number, { commands, options }: LargeShape): string =>
  `new Command().description("Group ${g}.")
${range(commands)
  .map(
    (c) =>
      `  .command("c${c} <input:string>", "Command ${g}.${c}.")${range(options)
        .map((o) => `.option("--o${o} <v:string>", "Option ${o}.")`)
        .join("")}
    .action((o, input) => { console.log(\`${output(g, c, "input", "o.o1")}\`); })`,
  )
  .join("\n")}`;

/** The Cliffy CLI, with `group` writing the calls that add each group. */
const cliffyCli = (shape: LargeShape, group: (g: number) => string): string => `
import { Command } from "@cliffy/command";
await new Command().name("forge").description("Big CLI.")
${range(shape.groups)
  .map((g) => `  ${group(g)}`)
  .join("\n")}
  .parse(process.argv.slice(2));
`;

/**
 * cliffy.io/docs/command/sub-commands, "Lazy loading", with a function that
 * returns the command. The parent sets the description, as for a file per group.
 */
const cliffy: Generate = oneFile((shape) =>
  cliffyCli(shape, (g) => `.command("g${g}", () => ${cliffyGroup(g, shape)}).description("Group ${g}.")`),
);

/**
 * cliffy.io/docs/command/sub-commands, "Lazy loading". The module exports the
 * command, and the parent sets its description too, so a usage error can
 * list the groups without loading them.
 */
const cliffySplit: Generate = filePerGroup(
  (shape) =>
    cliffyCli(shape, (g) => `.command("g${g}", () => import("${groupFile(g)}")).description("Group ${g}.")`),
  (g, shape) => `import { Command } from "@cliffy/command";\nexport default ${cliffyGroup(g, shape)};`,
);

// Stricli

const stricliParameters = (options: number): string =>
  `parameters: { flags: { ${range(options)
    .map(
      (o) =>
        `o${o}: { kind: "parsed", parse: String, brief: "Option ${o}.", placeholder: "v", optional: true }`,
    )
    .join(", ")} },
        positional: { kind: "tuple", parameters: [{ brief: "Input.", parse: String, placeholder: "input" }] } }`;

/** A Stricli command's function, as the body after its parameter list. */
const stricliFunc = (g: number, c: number): string =>
  `{ console.log(\`${output(g, c, "input", "flags.o1")}\`); }`;

/** The Stricli CLI, with `command` writing what each command has besides its docs and parameters. */
const stricliCli = (
  { groups, commands, options }: LargeShape,
  command: (g: number, c: number) => string,
): string => `
import { buildApplication, buildCommand, buildRouteMap, run } from "@stricli/core";
const app = buildApplication(buildRouteMap({ docs: { brief: "Big CLI." }, routes: {
${range(groups)
  .map(
    (g) => `  g${g}: buildRouteMap({ docs: { brief: "Group ${g}." }, routes: {
${range(commands)
  .map(
    (c) => `    c${c}: buildCommand({ docs: { brief: "Command ${g}.${c}." },
        ${stricliParameters(options)},
        ${command(g, c)} }),`,
  )
  .join("\n")}
  } }),`,
  )
  .join("\n")}
} }), { name: "forge" });
await run(app, process.argv.slice(2), { process });
`;

/** Stricli's docs, "Commands", with `func` for a command that isn't loaded lazily. */
const stricli: Generate = oneFile((shape) =>
  stricliCli(shape, (g, c) => `func(flags, input) ${stricliFunc(g, c)}`),
);

/**
 * Stricli's docs, "Commands", with `loader` importing the command's function
 * from its group's file. The routes and parameters stay in the entry, so help
 * and parsing don't load anything.
 */
const stricliSplit: Generate = filePerGroup(
  (shape) =>
    stricliCli(
      shape,
      (g, c) => `loader: async () => { const { c${c} } = await import("${groupFile(g)}"); return c${c}; }`,
    ),
  (g, { commands }) =>
    range(commands)
      .map((c) => `export function c${c}(flags, input) ${stricliFunc(g, c)}`)
      .join("\n"),
);

// gunshi

const gunshiArgs = (options: number): string =>
  `args: { input: { type: "positional", description: "Input." }, ${range(options)
    .map((o) => `o${o}: { type: "string", description: "Option ${o}." }`)
    .join(", ")} }`;

/** A gunshi command's runner, as the body after its parameter list. */
const gunshiRun = (g: number, c: number): string =>
  `{ console.log(\`${output(g, c, "values.input", "values.o1")}\`); }`;

/**
 * The gunshi CLI, with `command` writing each command. It's set up as
 * bench/gunshi.mjs is: strict, with the header printed only for help.
 */
const gunshiCli = (
  { groups, commands }: LargeShape,
  command: (g: number, c: number) => string,
  before = "",
): string => `
import { cli${before} } from "gunshi";
import { renderHeader } from "gunshi/renderer";
try {
  await cli(process.argv.slice(2), { name: "forge", description: "Big CLI." }, {
    name: "forge",
    description: "Big CLI.",
    strict: true,
    renderHeader: (ctx) => (ctx.values.help ? renderHeader(ctx) : ""),
    subCommands: {
${range(groups)
  .map(
    (g) => `      g${g}: { name: "g${g}", description: "Group ${g}.", subCommands: {
${range(commands)
  .map((c) => `        c${c}: ${command(g, c)},`)
  .join("\n")}
      } },`,
  )
  .join("\n")}
    },
  });
} catch {
  process.exitCode = 1;
}
`;

const gunshi: Generate = oneFile((shape) =>
  gunshiCli(
    shape,
    (g, c) =>
      `{ name: "c${c}", description: "Command ${g}.${c}.", ${gunshiArgs(shape.options)}, run({ values }) ${gunshiRun(g, c)} }`,
  ),
);

/**
 * gunshi.dev/guide/essentials/lazy-async: `lazy` with the definition in the
 * entry and a loader that imports the runner from its group's file.
 */
const gunshiSplit: Generate = filePerGroup(
  (shape) =>
    gunshiCli(
      shape,
      (g, c) =>
        `lazy(async () => { const { c${c} } = await import("${groupFile(g)}"); return c${c}; }, { name: "c${c}", description: "Command ${g}.${c}.", ${gunshiArgs(shape.options)} })`,
      ", lazy",
    ),
  (g, { commands }) =>
    range(commands)
      .map((c) => `export function c${c}({ values }) ${gunshiRun(g, c)}`)
      .join("\n"),
);

// Yargs

/** yargs docs/advanced.md: a command's builder runs only when a command line enters it. */
const yargs: Generate = oneFile(
  ({ groups, commands, options }) => `
import yargs from "yargs/yargs";
import { hideBin } from "yargs/helpers";
await yargs(hideBin(process.argv))
  .scriptName("forge")
  .usage("$0 <command>\\n\\nBig CLI.")
  .strict()
  .recommendCommands()
${range(groups)
  .map(
    (g) => `  .command("g${g} <command>", "Group ${g}.", (group) => group
${range(commands)
  .map(
    (c) => `    .command("c${c} <input>", "Command ${g}.${c}.", (cmd) => cmd
      .positional("input", { type: "string" })${range(options)
        .map((o) => `.option("o${o}", { describe: "Option ${o}.", type: "string" })`)
        .join("")},
      (argv) => { console.log(\`${output(g, c, "argv.input", "argv.o1")}\`); })`,
  )
  .join("\n")}
    .demandCommand())`,
  )
  .join("\n")}
  .demandCommand()
  .parseAsync();
`,
);

// node:util parseArgs

/** A group's commands for the hand-written `parseArgs` CLI, as an object literal. */
const parseArgsCommands = (g: number, { commands, options }: LargeShape): string => `{
${range(commands)
  .map(
    (c) =>
      `  c${c}: { description: "Command ${g}.${c}.", options: { ${range(options)
        .map((o) => `o${o}: { type: "string" }`)
        .join(", ")} }, run(input, v) { console.log(\`${output(g, c, "input", "v.o1")}\`); } },`,
  )
  .join("\n")}
}`;

/**
 * The hand-written `parseArgs` CLI, with `group` writing group `g`'s `load`
 * property, a function that returns or imports its commands. Root help lists
 * the groups, and a group's help lists its commands.
 */
const parseArgsCli = (shape: LargeShape, group: (g: number) => string, before = ""): string => `
import { parseArgs } from "node:util";
${before}const groups = {
${range(shape.groups)
  .map((g) => `  g${g}: { description: "Group ${g}.", ${group(g)} },`)
  .join("\n")}
};
function help(description, usage, heading, entries) {
  const names = Object.keys(entries);
  const width = Math.max(...names.map((name) => name.length));
  return [
    description,
    "",
    \`Usage: \${usage}\`,
    "",
    \`\${heading}:\`,
    ...names.map((name) => \`  \${name.padEnd(width)}  \${entries[name].description}\`),
    "",
    "Options:",
    "  -h, --help  Print help.",
  ].join("\\n");
}
const isHelp = (arg) => arg === undefined || arg === "-h" || arg === "--help";
async function main([groupName, name, ...rest]) {
  if (isHelp(groupName)) {
    console.log(help("Big CLI.", "forge <group> <command> [options]", "Groups", groups));
    return groupName === undefined ? 1 : 0;
  }
  if (!Object.hasOwn(groups, groupName)) {
    throw new Error(\`unknown command '\${groupName}'\`);
  }
  const group = groups[groupName];
  const commands = await group.load();
  if (isHelp(name)) {
    console.log(help(group.description, \`forge \${groupName} <command> [options]\`, "Commands", commands));
    return name === undefined ? 1 : 0;
  }
  if (!Object.hasOwn(commands, name)) {
    throw new Error(\`unknown command '\${groupName} \${name}'\`);
  }
  const command = commands[name];
  const { values, positionals } = parseArgs({ args: rest, options: command.options, allowPositionals: true });
  if (positionals.length !== 1) {
    throw new Error("expected 1 argument");
  }
  command.run(positionals[0], values);
  return 0;
}
try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(\`error: \${error.message}\`);
  process.exitCode = 1;
}
`;

const parseArgs: Generate = oneFile((shape) =>
  parseArgsCli(shape, (g) => `load: () => (${parseArgsCommands(g, shape)})`),
);

const parseArgsSplit: Generate = filePerGroup(
  (shape) =>
    parseArgsCli(
      shape,
      (g) => `load: () => import("${groupFile(g)}").then(body)`,
      "const body = (module) => module.default;\n",
    ),
  (g, shape) => `export default ${parseArgsCommands(g, shape)};`,
);

/** Each library's large CLI in one file, by the library's name in the benchmark. */
export const largeGenerators: ReadonlyMap<string, Generate> = new Map([
  ["@clo4/cli", clo4],
  ["Commander", commander],
  ["Yargs", yargs],
  ["citty", citty],
  ["sade", sade],
  ["Cliffy", cliffy],
  ["Stricli", stricli],
  ["gunshi", gunshi],
  ["node:util parseArgs", parseArgs],
]);

/**
 * The libraries whose large CLI has no help for a group. sade has no command
 * groups, so `forge g47 --help` is an unknown command.
 */
export const withoutGroupHelp: ReadonlySet<string> = new Set(["sade"]);

/** Each large CLI with a file per group, by the library's name in the benchmark. */
export const splitGenerators: ReadonlyMap<string, Generate> = new Map([
  ["@clo4/cli", clo4Split],
  ["citty", cittySplit],
  ["Cliffy", cliffySplit],
  ["Stricli", stricliSplit],
  ["gunshi", gunshiSplit],
  ["node:util parseArgs", parseArgsSplit],
]);
