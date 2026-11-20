import { expect, test } from "vitest";

import {
  addDefaults,
  argAt,
  argName,
  leadingDefaults,
  maxArgs,
  minArgs,
  unusedDefaults,
} from "../src/args.js";
import { parse } from "../src/parse.js";
import type { Arg } from "../src/types.js";

test("minArgs: one for each argument before the first optional one", () => {
  expect(minArgs([])).toBe(0);
  expect(minArgs([{}])).toBe(1);
  expect(minArgs([{}, {}])).toBe(2);
  expect(minArgs([{}, { isOptional: true }])).toBe(1);
  expect(minArgs([{ isOptional: true }])).toBe(0);
  expect(minArgs([{ isOptional: true }, {}])).toBe(0);
  // Accepts the raw spec value (scalar / undefined) without an array copy.
  expect(minArgs(undefined)).toBe(0);
  expect(minArgs({})).toBe(1);
  expect(minArgs({ isOptional: true })).toBe(0);
});

test("maxArgs: one for each argument, or any number with a variadic one", () => {
  expect(maxArgs([])).toBe(0);
  expect(maxArgs([{}])).toBe(1);
  expect(maxArgs([{}, {}])).toBe(2);
  expect(maxArgs([{}, { isVariadic: true }])).toBe(Infinity);
  expect(maxArgs([{ isVariadic: true }])).toBe(Infinity);
  expect(maxArgs([{ isVariadic: true }, {}])).toBe(Infinity);
  expect(maxArgs(undefined)).toBe(0);
  expect(maxArgs({})).toBe(1);
  expect(maxArgs({ isVariadic: true })).toBe(Infinity);
});

test("argAt: the argument a value is for, with a final variadic one taking the rest", () => {
  const one: Arg = { name: "one" };
  const rest: Arg = { name: "rest", isVariadic: true };
  expect(argAt(undefined, 0)).toBeUndefined();
  expect(argAt(one, 0)).toBe(one);
  expect(argAt(one, 1)).toBeUndefined();
  expect(argAt(rest, 3)).toBe(rest);
  expect(argAt([one, rest], 0)).toBe(one);
  expect(argAt([one, rest], 5)).toBe(rest);
  expect(argAt([one], 1)).toBeUndefined();
});

/** The values after `typed`, once the defaults of `args` fill in. */
function filled(args: Arg | readonly Arg[], typed: string[]): string[] {
  const values = [...typed];
  addDefaults(values, args, typed.length);
  return values;
}

test("addDefaults: fills in the arguments left out, up to the first without a default", () => {
  const args: Arg[] = [
    { name: "dir" },
    { name: "port", isOptional: true, default: "8080" },
    { name: "host", isOptional: true },
    { name: "mode", isOptional: true, default: "dev" },
  ];
  expect(filled(args, ["."])).toEqual([".", "8080"]);
  expect(filled(args, [".", "80"])).toEqual([".", "80"]);
  expect(filled(args, [".", "80", "localhost"])).toEqual([".", "80", "localhost", "dev"]);
  expect(filled(args, [".", "80", "localhost", "prod"])).toEqual([".", "80", "localhost", "prod"]);
  expect(filled({ name: "dir", isOptional: true, default: "." }, [])).toEqual(["."]);
  expect(filled({ name: "dir", isOptional: true, default: "." }, ["src"])).toEqual(["src"]);
});

test("addDefaults: a default never takes a required argument's place", () => {
  expect(
    filled(
      [
        { name: "width", default: "80" },
        { name: "height", default: "24" },
      ],
      [],
    ),
  ).toEqual([]);
  expect(
    filled(
      [
        { name: "width", default: "80" },
        { name: "height", default: "24" },
      ],
      ["100"],
    ),
  ).toEqual(["100"]);
  expect(filled([{ name: "width" }, { name: "height", isOptional: true, default: "24" }], ["100"])).toEqual([
    "100",
    "24",
  ]);
});

test("unusedDefaults: an option left out reads its leading defaults, unless its first argument is optional", () => {
  expect(unusedDefaults({ name: "--flag" })).toBeUndefined();
  expect(unusedDefaults({ name: "--size", args: [{ default: "80" }, { default: "24" }] })).toEqual([
    "80",
    "24",
  ]);
  expect(unusedDefaults({ name: "--size", args: [{ default: "80" }, {}, { default: "24" }] })).toEqual([
    "80",
  ]);
  expect(unusedDefaults({ name: "--size", args: [{}, { default: "24" }] })).toBeUndefined();
  expect(unusedDefaults({ name: "--inspect", args: { isOptional: true, default: "9229" } })).toBeUndefined();
});

test("leadingDefaults: the defaults an option reads left out or bare", () => {
  expect(leadingDefaults(undefined)).toEqual([]);
  expect(leadingDefaults({ isOptional: true, default: "9229" })).toEqual(["9229"]);
  expect(leadingDefaults([{ default: "80" }, { default: "24" }])).toEqual(["80", "24"]);
  expect(leadingDefaults([{}, { default: "24" }])).toEqual([]);
});

test("argName: help and messages call an argument without a name the same", async () => {
  expect(argName({ name: "file" })).toBe("file");
  expect(argName({})).toBe("argument");
  expect(argName({ name: "" })).toBe("argument");
  expect(argName({ name: "" }, "argument 2")).toBe("argument 2");
  const reject = {
    "~standard": { version: 1, vendor: "test", validate: () => ({ issues: [{ message: "no" }] }) },
  };
  await expect(parse(["x"], { name: "cli", args: { name: "", parse: reject } as Arg })).rejects.toMatchObject(
    {
      message: expect.stringContaining("<argument>"),
    },
  );
});
