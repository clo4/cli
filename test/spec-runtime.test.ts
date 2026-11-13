// The types `spec` gives an action restate rules the parser follows: which
// defaults it adds, when an option's value can be missing, which options a
// subcommand inherits. test/spec.test.ts checks the types alone. Here each
// action runs on real command lines and checks that what the parser gave it
// is what its type promised, so the two can't drift apart unnoticed.

import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import type { Spec } from "../src/types.js";
import { captureConsole, run } from "./helpers.js";

/**
 * Check that `list` has one of `lengths` and holds only strings. The type
 * only accepts lengths that the type of `list` allows, so the check can't be
 * looser than the type.
 */
function hasLength<L extends readonly unknown[]>(list: L, ...lengths: L["length"][]): void {
  expect(lengths).toContain(list.length);
  for (const item of list) {
    expect(item).toBeTypeOf("string");
  }
}

/** Check a value whose type says it's always a string. A type that allows `undefined` doesn't compile. */
function isString(value: string): void {
  expect(value).toBeTypeOf("string");
}

/** Run each of `lines` and expect its action to run without a failed check. */
async function runs(spec: Spec, lines: readonly (readonly string[])[], ran: () => number): Promise<void> {
  for (const [index, line] of lines.entries()) {
    const result = await captureConsole(() => run(spec, line));
    expect(result, `cli ${line.join(" ")}`).toEqual({ code: 0, stdout: "", stderr: "" });
    expect(ran(), `the action of: cli ${line.join(" ")}`).toBe(index + 1);
  }
}

test("positional arguments arrive in the shape their type promises", async () => {
  let ran = 0;
  const spec = CLI.spec({
    name: "cli",
    subcommands: [
      {
        name: "defaults",
        args: [{ name: "a" }, { name: "b", isOptional: true, default: "." }, { name: "c", isOptional: true }],
        action({ args }) {
          hasLength(args, 2, 3);
          ran++;
        },
      },
      {
        // The parser stops adding defaults at the first optional argument without one.
        name: "gap",
        args: [
          { name: "a", isOptional: true },
          { name: "b", isOptional: true, default: "." },
        ],
        action({ args }) {
          hasLength(args, 0, 1, 2);
          ran++;
        },
      },
      {
        name: "filled",
        args: [
          { name: "a", isOptional: true, default: "1" },
          { name: "b", isOptional: true, default: "2" },
        ],
        action({ args }) {
          hasLength(args, 2);
          ran++;
        },
      },
      {
        name: "rest",
        args: [{ name: "a" }, { name: "b", isOptional: true, isVariadic: true }],
        action({ args }) {
          isString(args[0]);
          ran++;
        },
      },
      {
        name: "group",
        requiresSubcommand: true,
        action({ args }) {
          hasLength(args, 0);
          ran++;
        },
      },
      {
        name: "none",
        action({ args }) {
          hasLength(args, 0);
          ran++;
        },
      },
    ],
  });
  await runs(
    spec,
    [
      ["defaults", "x"],
      ["defaults", "x", "y"],
      ["defaults", "x", "y", "z"],
      ["gap"],
      ["gap", "x"],
      ["gap", "x", "y"],
      ["filled"],
      ["filled", "x"],
      ["filled", "x", "y"],
      ["rest", "x"],
      ["rest", "x", "y", "z"],
      ["group"],
      ["group", "--"],
      ["none"],
    ],
    () => ran,
  );
});

test("option values arrive the way get and all promise", async () => {
  let ran = 0;
  const spec = CLI.spec({
    name: "cli",
    options: [{ name: "--level", isPersistent: true, args: { name: "n", default: "1" } }],
    subcommands: [
      {
        name: "build",
        options: [
          { name: "--default", args: { name: "v", default: "d" } },
          { name: "--required", isRequired: true, args: { name: "v" } },
          { name: "--pair", isRequired: true, args: [{ name: "a" }, { name: "b" }] },
          {
            name: "--corner",
            args: [
              { name: "x", default: "0" },
              { name: "y", default: "0" },
            ],
          },
          { name: "--tag", isRepeatable: true, args: { name: "t" } },
        ],
        action({ options }) {
          isString(options.get("--default"));
          isString(options.get("--required"));
          hasLength(options.all("--pair"), 2);
          hasLength(options.all("--corner"), 2);
          // A persistent option of the root, with a default.
          isString(options.get("--level"));
          hasLength(options.all("--level"), 1);
          expect(options.all("--tag").length).toBe(options.count("--tag"));
          ran++;
        },
      },
    ],
  });
  const required = ["--required", "r", "--pair", "a", "b"];
  await runs(
    spec,
    [
      ["build", ...required],
      ["build", ...required, "--default", "x", "--corner", "1", "2"],
      ["--level", "3", "build", ...required, "--tag", "a", "--tag", "b"],
      ["build", "--level", "3", ...required],
    ],
    () => ran,
  );
});

test("an option that shares a name is read by its ref the way its type promises", async () => {
  let ran = 0;
  const spec = CLI.spec({
    name: "cli",
    options: [{ name: ["-v", "--verbose"], isPersistent: true, isRepeatable: true, ref: "verbose" }],
    subcommands: [
      {
        name: "sub",
        options: [{ name: ["-v", "--version"], ref: "version", args: { name: "v", default: "1" } }],
        action({ options }) {
          isString(options.get("version"));
          hasLength(options.all("version"), 1);
          ran++;
        },
      },
    ],
  });
  await runs(
    spec,
    [["sub"], ["--verbose", "sub"], ["sub", "-v", "2"], ["--verbose", "--verbose", "sub", "--version", "2"]],
    () => ran,
  );
});
