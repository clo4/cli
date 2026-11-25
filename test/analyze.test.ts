import { expect, test } from "vitest";

import { analyze } from "../src/analyze.js";
import { number } from "../src/schemas.js";
import type { Arg, Option, Spec, Subcommand } from "../src/types.js";

// Where each problem the parser finds is in the command line: the index of the
// token, -1 for the program's name, and where an attached value starts.

async function problems(spec: Spec, argv: string[]) {
  const analysis = await analyze(spec, argv);
  expect(analysis.result).toBeNull();
  return analysis.problems;
}

const jobs: Option = {
  name: ["-j", "--jobs"],
  args: { name: "count", parse: number({ min: 1, int: true }) },
};
const build: Subcommand = {
  name: "build",
  args: { name: "input" },
  options: [{ name: ["-o", "--output"], args: { name: "dir" } }, jobs],
};
const spec: Spec = {
  name: "demo",
  options: [{ name: "--token", isPersistent: true, isRequired: true, args: {} }],
  subcommands: [build],
};

test("problems: an unknown option is in its own token", async () => {
  expect(await problems(spec, ["--token", "t", "build", "--nope"])).toMatchObject([{ token: 3 }]);
});

test("problems: an option missing its value is in the option's token, not the next one", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "-o", "--jobs", "3"])).toMatchObject([
    { message: "Option -o needs 1 argument", token: 4 },
  ]);
});

test("problems: an argument the command has no room for is in its own token", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "out"])).toMatchObject([{ token: 4 }]);
});

test("problems: a rejected value is in the token it was typed in", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "--jobs", "many"])).toMatchObject([
    { token: 5, start: undefined },
  ]);
});

test("problems: a rejected attached value starts after its separator", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "--jobs=many"])).toMatchObject([
    { token: 4, start: 7 },
  ]);
});

test("problems: a rejected argument is in the token it was typed in", async () => {
  const s: Spec = { name: "s", options: [{ name: "-v" }], args: [{}, { parse: number() }] };
  expect(await problems(s, ["a", "-v", "x"])).toMatchObject([{ token: 2 }]);
});

test("problems: a missing argument is in the token that names the command", async () => {
  expect(await problems(spec, ["--token", "t", "build"])).toMatchObject([{ token: 2 }]);
});

test("problems: a missing persistent option is in the token of the command that defines it", async () => {
  expect(await problems(spec, ["build", "src"])).toMatchObject([{ token: -1 }]);
});

test("problems: a value attached to an option that takes none starts after the separator", async () => {
  const s: Spec = { name: "s", options: [{ name: "--verbose" }] };
  expect(await problems(s, ["--verbose=1"])).toMatchObject([{ token: 0, start: 10 }]);
});

test("problems: a broken option rule is in the token of the option that has it", async () => {
  const s: Spec = { name: "s", options: [{ name: "-a", dependsOn: ["-b"] }, { name: "-b" }, { name: "-c" }] };
  expect(await problems(s, ["-c", "-a"])).toMatchObject([{ token: 1 }]);
});

test("problems: an invalid default is in no token", async () => {
  const s: Spec = { name: "s", options: [{ name: "--n", args: { default: "x", parse: number() } }] };
  expect(await problems(s, [])).toMatchObject([{ token: undefined }]);
});

test("analyze: says what each token is, and the argument each value is for", async () => {
  const dir: Arg = { name: "dir" };
  const output: Option = { name: ["-o", "--output"], args: dir };
  const command: Subcommand = { name: "build", args: { name: "input" }, options: [output, jobs] };
  const s: Spec = { name: "demo", subcommands: [command] };
  const { tokens, problems, result } = await analyze(s, ["build", "-o", "out", "src", "--jobs=2"]);
  expect(tokens).toEqual([
    { kind: "subcommand", command },
    { kind: "options", uses: [{ option: output, name: "-o" }], attached: null },
    { kind: "value", option: output, arg: dir },
    { kind: "argument", arg: command.args },
    {
      kind: "options",
      uses: [{ option: jobs, name: "--jobs" }],
      attached: { start: 7, separator: "=", arg: jobs.args },
    },
  ]);
  expect(problems).toEqual([]);
  expect(result?.path).toEqual([s, command]);
  expect(result?.options.get("--jobs")).toBe(2);
});

test("analyze: reads every token past a problem, and reports the first", async () => {
  const { tokens, problems } = await analyze(spec, ["--nope", "--token", "t", "build", "--nope"]);
  expect(tokens.map((t) => t.kind)).toEqual(["options", "options", "value", "subcommand", "options"]);
  expect(tokens[0]).toEqual({ kind: "options", uses: [{ option: null, name: "--nope" }], attached: null });
  expect(problems).toMatchObject([{ token: 0 }]);
});

test("analyze: reports every problem the finished line has", async () => {
  const { problems } = await analyze(spec, ["build", "--jobs", "0"]);
  expect(problems.map((p) => p.token)).toEqual([0, -1, 2]);
});

test("analyze: reads a loaded command's tokens", async () => {
  const loaded: Subcommand = { name: "remote", options: [{ name: "--force" }] };
  const s: Spec = { name: "s", subcommands: [{ name: "remote", loadSpec: async () => loaded }] };
  const { tokens, result } = await analyze(s, ["remote", "--force"]);
  expect(tokens[1]).toMatchObject({ kind: "options", uses: [{ option: loaded.options![0] }] });
  expect(result?.options.has("--force")).toBe(true);
});

test("analyze: rejects with what a loadSpec throws", async () => {
  const s: Spec = {
    name: "s",
    subcommands: [{ name: "remote", loadSpec: () => Promise.reject(new Error("offline")) }],
  };
  await expect(analyze(s, ["remote"])).rejects.toThrow("offline");
});
