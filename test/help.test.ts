import { expect, test } from "vitest";

import { getHelp } from "../src/help.js";
import type { Spec } from "../src/types.js";
import { expectIncludes, expectNotIncludes } from "./helpers.js";

test("help: no path, no subcommands", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    description: "019283",
    options: [
      { name: ["-o", "--option"], description: "112233" },
      {
        name: ["--long-first", "--shorter", "-s"],
        description: "998877",
      },
    ],
  };
  const msg = getHelp([spec]);
  expect(msg.startsWith("019283")).toBe(true);
  expectIncludes(msg, "TEST_NAME [flags]\n");
  expectIncludes(msg, "-o, --option");
  expectIncludes(msg, "112233");
  expectIncludes(msg, "-s, --shorter, --long-first");
  expectIncludes(msg, "998877");
});

test("help: hidden options and subcommands are excluded", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [
      { name: "--shown", description: "VISIBLE_FLAG" },
      { name: "--secret", description: "HIDDEN_FLAG", hidden: true },
    ],
    subcommands: [
      { name: "shown-cmd", description: "VISIBLE_CMD" },
      { name: "secret-cmd", description: "HIDDEN_CMD", hidden: true },
    ],
  };
  const msg = getHelp([spec]);
  expectIncludes(msg, "shown-cmd");
  expectIncludes(msg, "VISIBLE_CMD");
  expectIncludes(msg, "--shown");
  expectIncludes(msg, "VISIBLE_FLAG");
  expectNotIncludes(msg, "secret-cmd");
  expectNotIncludes(msg, "HIDDEN_CMD");
  expectNotIncludes(msg, "--secret");
  expectNotIncludes(msg, "HIDDEN_FLAG");
});

test("help: no path, with subcommands", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [{ name: ["-o", "--option"], description: "112233" }],
    subcommands: [
      { name: "unique-name", description: "98765" },
      { name: "very-good", description: "12345" },
    ],
  };
  const msg = getHelp([spec]);
  expect(msg.startsWith("Usage:\n")).toBe(true);
  expectIncludes(msg, "\n  TEST_NAME [flags]\n");
  expectIncludes(msg, "\nCommands:\n");
  expectIncludes(msg, "unique-name");
  expectIncludes(msg, "98765");
  expectIncludes(msg, "very-good");
  expectIncludes(msg, "12345");
});

test("help: no path, with subcommands, requires subcommand", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    requiresSubcommand: true,
    options: [{ name: ["-o", "--option"], description: "112233" }],
    subcommands: [
      { name: "unique-name", description: "98765" },
      { name: "very-good", description: "12345" },
    ],
  };
  const msg = getHelp([spec]);
  expect(msg.startsWith("Usage:\n")).toBe(true);
  expectIncludes(msg, "TEST_NAME [flags] <command>");
  expectIncludes(msg, "\nCommands:\n");
  expectIncludes(msg, "unique-name");
  expectIncludes(msg, "98765");
  expectIncludes(msg, "very-good");
  expectIncludes(msg, "12345");
});

test("help: path with persistent options", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    action: () => {},
    options: [
      {
        name: ["-o", "--option"],
        description: "112233",
        isPersistent: true,
      },
    ],
    subcommands: [
      {
        name: "unique-name",
        description: "98765",
        options: [{ name: "--silent", description: "888888" }],
      },
      {
        name: "very-good",
        description: "12345",
        options: [{ name: "--not-here", description: "DO NOT INCLUDE" }],
      },
    ],
  };
  const msg = getHelp([spec, spec.subcommands![0]]);
  expectIncludes(msg, "TEST_NAME unique-name");
  expectIncludes(msg, "\nFlags:\n");
  expectIncludes(msg, "\nGlobal flags:\n");
  expectIncludes(msg, "-o, --option");
  expectIncludes(msg, "112233");
  expectIncludes(msg, "--silent");
  expectIncludes(msg, "888888");
  expectNotIncludes(msg, "--not-here");
  expectNotIncludes(msg, "DO NOT INCLUDE");
});

test("help: path with persistent options and no option on command", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    action: () => {},
    options: [
      {
        name: ["-o", "--option"],
        description: "112233",
        isPersistent: true,
      },
    ],
    subcommands: [{ name: "unique-name", description: "98765" }],
  };
  const msg = getHelp([spec, spec.subcommands![0]]);
  expectIncludes(msg, "TEST_NAME unique-name");
  expectNotIncludes(msg, "\nFlags:\n");
  expectIncludes(msg, "\nGlobal flags:\n");
  expectIncludes(msg, "-o, --option");
  expectIncludes(msg, "112233");
  expect(msg.indexOf("\nGlobal flags:\n")).toBeLessThan(msg.indexOf("-o, --option"));
});

test("help: option arguments are summarized", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [
      { name: "--opt", args: { name: "v", isOptional: true }, requiresSeparator: true },
      { name: "--colon", args: { name: "v" }, requiresSeparator: ":" },
      {
        name: "--many",
        args: [
          { name: "x" },
          { name: "y", isOptional: true },
          { name: "z", isVariadic: true, isOptional: true },
        ],
      },
      { name: "--unnamed", args: {} },
    ],
  };
  const msg = getHelp([spec]);
  expectIncludes(msg, "  --opt[=v]  ");
  expectIncludes(msg, "  --colon:<v>  ");
  expectIncludes(msg, "  --many <x> [y] [z]...  ");
  expectIncludes(msg, "  --unnamed <argument>  ");
});

test("help: a multi-line option description stays aligned", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [{ name: "--long-name", description: "line one\nline two" }, { name: "-s" }],
  };
  expectIncludes(
    getHelp([spec]),
    "  --long-name  line one\n               line two\n  -s           No description\n",
  );
});

test("help: a subcommand row shows its aliases and its description's first paragraph", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    subcommands: [{ name: ["longer", "s"], description: "first\nstill first\n\nsecond paragraph" }],
  };
  const msg = getHelp([spec]);
  expectIncludes(msg, "Commands:\n  s, longer  first\n             still first\n");
  expectNotIncludes(msg, "second paragraph");
});

test("help: usage names the longest alias and lists required options", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [{ name: "--token", isPersistent: true, isRequired: true, args: { name: "t" } }],
    subcommands: [{ name: ["s", "longer"], options: [{ name: "--need", isRequired: true }] }],
  };
  const msg = getHelp([spec, spec.subcommands![0]]);
  expectIncludes(msg, "Usage:\n  TEST_NAME longer --need --token <t> [flags]\n");
});

test("help: a description's common indentation is removed", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    description: `
      First line.
        Indented line.
    `,
  };
  expect(getHelp([spec]).startsWith("First line.\n  Indented line.\n\nUsage:")).toBe(true);
});

test("help: an option that requires a separator shows the separator in effect", () => {
  const sub: Spec = { name: "sub", parserDirectives: { optionArgSeparators: "=" } };
  const spec: Spec = {
    name: "TEST_NAME",
    parserDirectives: { optionArgSeparators: [":", "="] },
    options: [{ name: "--o", args: { name: "v" }, requiresSeparator: true, isPersistent: true }],
    subcommands: [sub],
  };
  expectIncludes(getHelp([spec]), "  --o:<v>  ");
  expectIncludes(getHelp([spec, sub]), "  --o=<v>  ");
});

test("help: an option that another option shadows isn't listed", () => {
  const sub: Spec = {
    name: "sub",
    options: [
      { name: "--g", isPersistent: true, description: "child global" },
      { name: "--l", description: "child local" },
    ],
  };
  const spec: Spec = {
    name: "TEST_NAME",
    options: [
      { name: "--g", isPersistent: true, description: "parent global" },
      { name: "--l", isPersistent: true, description: "parent local" },
      { name: ["-k", "--keep"], isPersistent: true, description: "still reachable" },
    ],
    subcommands: [{ ...sub, options: [...sub.options!, { name: "--keep", isPersistent: true }] }],
  };
  const msg = getHelp([spec, spec.subcommands![0]]);
  expectIncludes(msg, "child global");
  expectIncludes(msg, "child local");
  expectIncludes(msg, "still reachable");
  expectNotIncludes(msg, "parent global");
  expectNotIncludes(msg, "parent local");
});

test("help: an option lists only the names that still refer to it", () => {
  const spec: Spec = {
    name: "TEST_NAME",
    options: [
      { name: ["-a", "--all"], description: "first" },
      { name: "--all", description: "second" },
    ],
  };
  const msg = getHelp([spec]);
  expectIncludes(msg, "  -a     first");
  expectIncludes(msg, "  --all  second");
  expectNotIncludes(msg, "-a, --all");
});
