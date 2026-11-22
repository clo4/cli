import { expect, test } from "vitest";

import { parse } from "../src/parse.js";
import { ParseError } from "../src/errors.js";
import { number } from "../src/schemas.js";
import type { Option, Spec, Subcommand } from "../src/types.js";

// Where each problem the parser finds is in the command line: the index of the
// token, -1 for the program's name, and where an attached value starts.

async function problems(spec: Spec, argv: string[]) {
  try {
    await parse(argv, spec);
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw error;
    }
    return (error.problems ?? [error]).map((p) => ({
      message: p.message,
      token: p.context.token,
      start: p.context.start,
    }));
  }
  throw new Error("Expected a throw");
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

test("positions: an unknown option is in its own token", async () => {
  expect(await problems(spec, ["--token", "t", "build", "--nope"])).toMatchObject([{ token: 3 }]);
});

test("positions: an option missing its value is in the option's token, not the next one", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "-o", "--jobs", "3"])).toMatchObject([
    { message: "Option -o needs 1 argument", token: 4 },
  ]);
});

test("positions: an argument the command has no room for is in its own token", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "out"])).toMatchObject([{ token: 4 }]);
});

test("positions: a rejected value is in the token it was typed in", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "--jobs", "many"])).toMatchObject([
    { token: 5, start: undefined },
  ]);
});

test("positions: a rejected attached value starts after its separator", async () => {
  expect(await problems(spec, ["--token", "t", "build", "src", "--jobs=many"])).toMatchObject([
    { token: 4, start: 7 },
  ]);
});

test("positions: a rejected argument is in the token it was typed in", async () => {
  const s: Spec = { name: "s", options: [{ name: "-v" }], args: [{}, { parse: number() }] };
  expect(await problems(s, ["a", "-v", "x"])).toMatchObject([{ token: 2 }]);
});

test("positions: a missing argument is in the token that names the command", async () => {
  expect(await problems(spec, ["--token", "t", "build"])).toMatchObject([{ token: 2 }]);
});

test("positions: a missing persistent option is in the token of the command that defines it", async () => {
  expect(await problems(spec, ["build", "src"])).toMatchObject([{ token: -1 }]);
});

test("positions: a value attached to an option that takes none starts after the separator", async () => {
  const s: Spec = { name: "s", options: [{ name: "--verbose" }] };
  expect(await problems(s, ["--verbose=1"])).toMatchObject([{ token: 0, start: 10 }]);
});

test("positions: a broken option rule is in the token of the option that has it", async () => {
  const s: Spec = { name: "s", options: [{ name: "-a", dependsOn: ["-b"] }, { name: "-b" }, { name: "-c" }] };
  expect(await problems(s, ["-c", "-a"])).toMatchObject([{ token: 1 }]);
});

test("positions: an invalid default is in no token", async () => {
  const s: Spec = { name: "s", options: [{ name: "--n", args: { default: "x", parse: number() } }] };
  expect(await problems(s, [])).toMatchObject([{ token: undefined }]);
});
