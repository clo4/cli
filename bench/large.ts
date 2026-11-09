/**
 * Generated adapters for CLIs with many commands. Each CLI has `groups`
 * command groups of `commands` commands, and each command takes one argument
 * and `options` options that take a value. Running a command prints
 * `run:<group>:<command>:<argument>:<value of --o1>`.
 *
 * Only the libraries below have a generator. citty's commands are functions
 * that citty calls only for the command that runs. The other libraries build
 * every command when the CLI starts.
 */

export interface LargeShape {
  groups: number;
  commands: number;
  options: number;
}

type Generate = (shape: LargeShape) => string;

const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);

/** The command line that runs one command near the end of `shape`, and what it prints. */
export function largeCommandLine(shape: LargeShape): { args: string[]; stdout: string } {
  const group = `g${shape.groups - 3}`;
  const command = `c${shape.commands - 2}`;
  return { args: [group, command, "in", "--o1", "val"], stdout: `run:${group}:${command}:in:val\n` };
}

const clo4: Generate = ({ groups, commands, options }) => `
import { help, run } from "../dist/index.js";
process.exitCode = await run({
  name: "forge", description: "Big CLI.", options: [help],
  subcommands: [
${range(groups)
  .map(
    (g) => `    { name: "g${g}", description: "Group ${g}.", requiresSubcommand: true, subcommands: [
${range(commands)
  .map(
    (c) => `      { name: "c${c}", description: "Command ${g}.${c}.", args: { name: "input" },
        options: [${range(options)
          .map((o) => `{ name: "--o${o}", description: "Option ${o}.", args: { name: "v" } }`)
          .join(", ")}],
        action({ args, options }) { console.log(\`run:g${g}:c${c}:\${args[0]}:\${options.get("--o1")}\`); } },`,
  )
  .join("\n")}
    ] },`,
  )
  .join("\n")}
  ],
});
`;

const sade: Generate = ({ groups, commands, options }) => `
import sade from "sade";
const prog = sade("forge").describe("Big CLI.");
${range(groups)
  .flatMap((g) =>
    range(commands).map(
      (c) =>
        `prog.command("g${g} c${c} <input>", "Command ${g}.${c}.")${range(options)
          .map((o) => `.option("--o${o}", "Option ${o}.")`)
          .join("")}.action((input, o) => { console.log(\`run:g${g}:c${c}:\${input}:\${o.o1}\`); });`,
    ),
  )
  .join("\n")}
prog.parse(process.argv, { unknown: (flag) => \`Unknown option: \${flag}\` });
`;

const commander: Generate = ({ groups, commands, options }) => `
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
        .join("")}.action((input, o) => { console.log(\`run:g${g}:c${c}:\${input}:\${o.o1}\`); });`,
  )
  .join("\n")}
}`,
  )
  .join("\n")}
program.parse();
`;

const citty: Generate = ({ groups, commands, options }) => `
import { defineCommand, runMain } from "citty";
await runMain(defineCommand({ meta: { name: "forge", description: "Big CLI." }, subCommands: {
${range(groups)
  .map(
    (g) => `  g${g}: () => defineCommand({ meta: { name: "g${g}", description: "Group ${g}." }, subCommands: {
${range(commands)
  .map(
    (c) => `    c${c}: () => defineCommand({ meta: { name: "c${c}", description: "Command ${g}.${c}." },
      args: { input: { type: "positional", required: true }, ${range(options)
        .map((o) => `o${o}: { type: "string", description: "Option ${o}." }`)
        .join(", ")} },
      run({ args }) { console.log(\`run:g${g}:c${c}:\${args.input}:\${args.o1}\`); } }),`,
  )
  .join("\n")}
  } }),`,
  )
  .join("\n")}
} }));
`;

const parseArgs: Generate = ({ groups, commands, options }) => `
import { parseArgs } from "node:util";
const commands = {
${range(groups)
  .flatMap((g) =>
    range(commands).map(
      (c) =>
        `  "g${g} c${c}": { description: "Command ${g}.${c}.", options: { ${range(options)
          .map((o) => `o${o}: { type: "string" }`)
          .join(", ")} }, run(input, v) { console.log(\`run:g${g}:c${c}:\${input}:\${v.o1}\`); } },`,
    ),
  )
  .join("\n")}
};
try {
  const [group, name, ...rest] = process.argv.slice(2);
  const command = commands[\`\${group} \${name}\`];
  if (command === undefined) {
    throw new Error("unknown command");
  }
  const { values, positionals } = parseArgs({ args: rest, options: command.options, allowPositionals: true });
  if (positionals.length !== 1) {
    throw new Error("expected 1 argument");
  }
  command.run(positionals[0], values);
} catch (error) {
  console.error(\`error: \${error.message}\`);
  process.exitCode = 1;
}
`;

/** The source of each library's large CLI, by the library's name in the benchmark. */
export const largeGenerators: ReadonlyMap<string, Generate> = new Map([
  ["@clo4/cli", clo4],
  ["Commander", commander],
  ["citty", citty],
  ["sade", sade],
  ["node:util parseArgs", parseArgs],
]);
