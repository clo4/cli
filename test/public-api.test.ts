import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import * as Testing from "../src/testing.js";
import * as Analyze from "../src/analyze.js";

test("public API stays minimal and namespace-friendly", () => {
  expect(Object.keys(CLI).sort()).toEqual([
    "choice",
    "command",
    "complete",
    "completion",
    "default",
    "help",
    "helpCommand",
    "int",
    "many",
    "number",
    "optional",
    "print",
    "printError",
    "run",
    "sepBy",
    "seq",
    "spec",
    "text",
    "uint",
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

test("the analyze entrypoint exports analyze", () => {
  expect(Object.keys(Analyze)).toEqual(["analyze"]);
});

test("package exports stay limited to runtime, testing and analyze entrypoints", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(pkg.exports).sort()).toEqual([".", "./analyze", "./testing"]);
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
    "CommandPath",
    "CompleteOptions",
    "NonEmptyArray",
    "Option",
    "OptionArgs",
    "Parser",
    "Part",
    "RunOptions",
    "Seq",
    "Shell",
    "SingleOrArray",
    "SingleOrArrayOrEmpty",
    "Spec",
    "StandardResult",
    "StandardSchemaV1",
    "Subcommand",
    "SuggestInit",
    "Suggester",
    "Suggestion",
    "Template",
  ]);
  expect(await exportedTypes("testing.ts")).toEqual(["TestContextLike", "TestNamingStyle", "TestOptions"]);
  expect(await exportedTypes("analyze.ts")).toEqual(["Analysis", "ParseResult", "Problem", "TokenReading"]);
});

test("the completion command is written with public functions alone", async () => {
  // Like any spec, it uses what the package exports, so it can't do what a
  // user's command couldn't.
  const source = await readFile(new URL("../src/completion.ts", import.meta.url), "utf8");
  const imported = [...source.matchAll(/^import \{([^}]*)\} from "[^"]+";$/gm)].flatMap(([, names]) =>
    names.split(",").map((name) => name.trim()),
  );
  expect(imported.length).toBeGreaterThan(0);
  for (const name of imported) {
    expect(Object.keys(CLI)).toContain(name);
  }
});
