import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import * as Testing from "../src/testing.js";

test("public API stays minimal and namespace-friendly", () => {
  expect(Object.keys(CLI).sort()).toEqual([
    "completion",
    "default",
    "help",
    "helpCommand",
    "printError",
    "run",
  ]);
  expect(typeof CLI.run).toBe("function");
  expect(typeof CLI.help).toBe("object");
  expect(typeof CLI.helpCommand).toBe("object");
  expect(typeof CLI.completion).toBe("object");
});

test("the testing entrypoint exports the spec checks and test", () => {
  expect(Object.keys(Testing).sort()).toEqual([
    "assertCommonOptionsArePersistent",
    "assertDescriptionLineLengthUnder69",
    "assertEverythingHasDescription",
    "assertNamesHaveNoExtraWhitespace",
    "assertNamesReadBack",
    "assertOptionArgSeparatorsHaveCharacters",
    "assertOptionNameReferencesExist",
    "assertOptionsDoNotShadowPersistentOptions",
    "assertOptionsHaveDifferentNamesFromParents",
    "assertOptionsHaveLocallyUniqueNames",
    "assertPlusMinusOptionsTakeOneArg",
    "assertPrefixMatchCommandsHaveNoArguments",
    "assertRepeatableOptionsArePositiveIntegers",
    "assertRequiredArgumentsDoNotFollowOptionalArguments",
    "assertRequiresSeparatorTakesOneArg",
    "assertSubcommandsHaveLocallyUniqueNames",
    "test",
    "testSpec",
  ]);
});

test("package exports stay limited to runtime and testing entrypoints", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    exports: Record<string, unknown>;
  };
  expect(Object.keys(pkg.exports).sort()).toEqual([".", "./testing"]);
});
