import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import * as Testing from "../src/testing.js";

test("public API stays minimal and namespace-friendly", () => {
  expect(Object.keys(CLI).sort()).toEqual([
    "command",
    "completion",
    "default",
    "help",
    "helpCommand",
    "printError",
    "run",
    "spec",
  ]);
  expect(Object.keys(CLI.default).sort()).toEqual(
    Object.keys(CLI)
      .filter((name) => name !== "default")
      .sort(),
  );
  expect(typeof CLI.run).toBe("function");
  expect(typeof CLI.help).toBe("object");
  expect(typeof CLI.helpCommand).toBe("object");
  expect(typeof CLI.completion).toBe("object");
});

test("the testing entrypoint exports test and testSpec", () => {
  expect(Object.keys(Testing).sort()).toEqual(["test", "testSpec"]);
});

test("package exports stay limited to runtime and testing entrypoints", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(pkg.exports).sort()).toEqual([".", "./testing"]);
});

/** The names of the types a source file exports. */
async function exportedTypes(file: string): Promise<string[]> {
  const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
  const listed = [...source.matchAll(/^export type \{([^}]*)\}/gm)].flatMap((match) =>
    match[1].split(",").map((name) => name.trim()),
  );
  const declared = [...source.matchAll(/^export (?:type|interface) (\w+)/gm)].map((match) => match[1]);
  return [...listed, ...declared].filter(Boolean).sort();
}

test("the entrypoints export these types", async () => {
  expect(await exportedTypes("index.ts")).toEqual([
    "Action",
    "ActionInit",
    "Arg",
    "CommandBody",
    "CommandPath",
    "Generator",
    "NonEmptyArray",
    "Option",
    "OptionArgs",
    "RunOptions",
    "Shell",
    "SingleOrArray",
    "SingleOrArrayOrEmpty",
    "Spec",
    "Subcommand",
    "Suggestion",
    "Template",
  ]);
  expect(await exportedTypes("testing.ts")).toEqual(["TestContextLike", "TestNamingStyle", "TestOptions"]);
});
