import { expect, test } from "vitest";

import { getHelp, usage } from "../src/help.js";
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
    action: usage,
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
    action: usage,
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
