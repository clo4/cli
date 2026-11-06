import { expect, test } from "vitest";

import { help, helpCommand } from "../src/help.js";
import type { Option, Spec } from "../src/types.js";
import * as Testing from "../src/testing.js";

test("testing: run testSpec on helpCommand", async () => {
  await expect(Testing.testSpec(helpCommand)()).resolves.toBeUndefined();
});

test("testing: assertOptionsHaveLocallyUniqueNames", () => {
  Testing.assertOptionsHaveLocallyUniqueNames({ name: "test" });
  Testing.assertOptionsHaveLocallyUniqueNames({
    name: "test",
    options: [{ name: "one" }],
  });
  Testing.assertOptionsHaveLocallyUniqueNames({
    name: "test",
    options: [{ name: "one" }, { name: "two" }],
  });
  expect(() =>
    Testing.assertOptionsHaveLocallyUniqueNames({
      name: "test",
      options: [{ name: "one" }, { name: "one" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionsHaveLocallyUniqueNames({
      name: "test",
      options: [{ name: ["one", "one"] }],
    }),
  ).toThrow();
});

test("testing: assertOptionsHaveDifferentNamesFromParents", () => {
  const check = Testing.assertOptionsHaveDifferentNamesFromParents;
  const withChild = (parent: Option, child: Option): Spec => ({
    name: "test",
    options: [parent],
    subcommands: [{ name: "sub", options: [child] }],
  });

  // Different options with exactly the same names
  expect(() => check(withChild({ name: "-C", args: {} }, { name: "-C" }))).toThrow();
  expect(() => check(withChild({ name: ["-C", "--cd"], args: {} }, { name: ["--cd", "-C"] }))).toThrow();
  expect(() =>
    check({
      name: "test",
      options: [{ name: "-C", args: {} }],
      subcommands: [{ name: "mid", subcommands: [{ name: "leaf", options: [{ name: "-C" }] }] }],
    }),
  ).toThrow();

  // Each option has a name of its own
  check(withChild({ name: ["-C", "--cd"], args: {} }, { name: ["-C", "--moved"] }));
  check(withChild({ name: "-a" }, { name: "-b" }));

  // Identical options
  const constant: Option = { name: ["-v", "--verbose"], description: "Print more." };
  check(withChild(constant, constant));
  check(withChild(constant, { ...constant }));
  check(withChild(constant, { ...constant, name: ["--verbose", "-v"] }));
  check(withChild(help, help));
  check(withChild({ name: "--help", action() {} }, { name: "--help", action() {} }));
  check(withChild({ name: "-t", args: { name: "tag" } }, { name: "-t", args: { name: "tag" } }));

  // Persistent parents belong to assertOptionsDoNotShadowPersistentOptions
  check(withChild({ name: "-C", isPersistent: true, args: {} }, { name: "-C" }));

  // Same shape except for a property that changes the meaning
  expect(() =>
    check(withChild({ name: "-t", args: { name: "tag" } }, { name: "-t", args: { name: "tags" } })),
  ).toThrow();
});

test("testing: testSpec rejects a clash with a parent option", async () => {
  const spec: Spec = {
    name: "test",
    description: "Test.",
    options: [{ name: "-C", description: "Directory.", args: { name: "path" } }],
    subcommands: [
      { name: "one", description: "One.", options: [{ name: "-C", description: "Copies." }] },
      { name: "two", description: "Two." },
    ],
  };
  await expect(Testing.testSpec(spec)()).rejects.toThrow(/same names/);
});

test("testing: assertRepeatableOptionsHaveNoArguments", () => {
  Testing.assertRepeatableOptionsHaveNoArguments({ name: "test" });
  Testing.assertRepeatableOptionsHaveNoArguments({
    name: "test",
    options: [{ name: "one" }],
  });
  Testing.assertRepeatableOptionsHaveNoArguments({
    name: "test",
    options: [
      { name: "one", isRepeatable: true },
      { name: "two", isRepeatable: 2 },
    ],
  });
  expect(() =>
    Testing.assertRepeatableOptionsHaveNoArguments({
      name: "test",
      options: [{ name: "one", isRepeatable: true, args: {} }],
    }),
  ).toThrow();
});

test("testing: assertSubcommandsHaveLocallyUniqueNames", () => {
  Testing.assertSubcommandsHaveLocallyUniqueNames({ name: "test" });
  Testing.assertSubcommandsHaveLocallyUniqueNames({
    name: "test",
    subcommands: [{ name: "one" }, { name: "two" }],
  });
  expect(() =>
    Testing.assertSubcommandsHaveLocallyUniqueNames({
      name: "test",
      subcommands: [{ name: "one" }, { name: "one" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertSubcommandsHaveLocallyUniqueNames({
      name: "test",
      subcommands: [{ name: ["one", "one"] }],
    }),
  ).toThrow();
});

test("testing: assertOptionsDoNotShadowPersistentOptions", () => {
  Testing.assertOptionsDoNotShadowPersistentOptions({ name: "test" });
  Testing.assertOptionsDoNotShadowPersistentOptions({
    name: "test",
    options: [{ name: "one", isPersistent: true }, { name: "two" }],
  });
  Testing.assertOptionsDoNotShadowPersistentOptions({
    name: "test",
    options: [{ name: "one", isPersistent: true }],
    subcommands: [
      {
        name: "subcommand",
        options: [{ name: "two" }],
      },
    ],
  });
  Testing.assertOptionsDoNotShadowPersistentOptions({
    name: "test",
    options: [{ name: "one", isPersistent: true }, { name: "one" }],
  });
  expect(() =>
    Testing.assertOptionsDoNotShadowPersistentOptions({
      name: "test",
      options: [{ name: "one", isPersistent: true }],
      subcommands: [
        {
          name: "subcommand",
          options: [{ name: "one" }],
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertRepeatableOptionsArePositiveIntegers", () => {
  Testing.assertRepeatableOptionsArePositiveIntegers({ name: "test" });
  Testing.assertRepeatableOptionsArePositiveIntegers({
    name: "test",
    options: [{ name: "one" }, { name: "two", isRepeatable: 2 }, { name: "three", isRepeatable: 2 }],
  });
  Testing.assertRepeatableOptionsArePositiveIntegers({
    name: "test",
    options: [{ name: "one", isRepeatable: true }],
    subcommands: [
      {
        name: "subcommand",
        options: [{ name: "two" }],
      },
    ],
  });
  for (const isRepeatable of [0, 1, -1, NaN, Infinity, 2.1]) {
    expect(() =>
      Testing.assertRepeatableOptionsArePositiveIntegers({
        name: "test",
        options: [{ name: "one", isRepeatable }],
      }),
    ).toThrow();
  }
});

test("testing: assertRequiredArgumentsDoNotFollowOptionalArguments", () => {
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({ name: "test" });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    options: [
      { name: "one" },
      { name: "two", args: {} },
      { name: "two", args: { isOptional: true } },
      { name: "three", args: [{}, {}] },
      { name: "four", args: [{}, { isOptional: true }] },
      { name: "four", args: [{ isOptional: true }, { isOptional: true }] },
    ],
  });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    args: {},
  });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    args: { isOptional: true },
  });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    args: [{}, {}],
  });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    args: [{}, { isOptional: true }],
  });
  Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
    name: "test",
    args: [{ isOptional: true }, { isOptional: true }],
  });
  expect(() =>
    Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
      name: "test",
      args: [{ isOptional: true }, {}],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertRequiredArgumentsDoNotFollowOptionalArguments({
      name: "test",
      options: [{ name: "one", args: [{ isOptional: true }, {}] }],
    }),
  ).toThrow();
});

test("testing: assertLongOptionNamesDoNotStartWithSingleDash", () => {
  Testing.assertLongOptionNamesDoNotStartWithSingleDash({ name: "test" });
  Testing.assertLongOptionNamesDoNotStartWithSingleDash({
    name: "test",
    options: [
      { name: "one" },
      { name: "--one" },
      { name: "-o" },
      { name: "+o" },
      { name: "-" },
      { name: "--" },
    ],
    subcommands: [
      {
        name: "example",
        options: [{ name: ["-", "--"] }],
      },
    ],
  });
  Testing.assertLongOptionNamesDoNotStartWithSingleDash({
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "-one" }],
  });
  Testing.assertLongOptionNamesDoNotStartWithSingleDash({
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    subcommands: [
      {
        name: "example",
        options: [{ name: "-one" }],
      },
    ],
  });
  expect(() =>
    Testing.assertLongOptionNamesDoNotStartWithSingleDash({
      name: "test",
      options: [{ name: "-one" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertLongOptionNamesDoNotStartWithSingleDash({
      name: "test",
      subcommands: [
        {
          name: "example",
          options: [{ name: "-one" }],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertLongOptionNamesDoNotStartWithSingleDash({
      name: "test",
      subcommands: [
        {
          name: "example",
          options: [{ name: "+one" }],
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertOptionNamesStartWithDashes", () => {
  Testing.assertOptionNamesStartWithDashes({ name: "test" });
  Testing.assertOptionNamesStartWithDashes({
    name: "test",
    options: [{ name: "--one" }, { name: "-o" }, { name: "-" }, { name: "--" }],
    subcommands: [
      {
        name: "example",
        options: [{ name: ["-", "--"] }],
      },
    ],
  });
  Testing.assertOptionNamesStartWithDashes({
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "example" }],
    subcommands: [
      {
        name: "example",
        options: [{ name: "one" }],
      },
    ],
  });
  expect(() =>
    Testing.assertOptionNamesStartWithDashes({
      name: "test",
      options: [{ name: "one" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionNamesStartWithDashes({
      name: "test",
      subcommands: [
        {
          name: "example",
          options: [{ name: "one" }],
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertNothingIsNamedDashDash", () => {
  Testing.assertNothingIsNamedDashDash({ name: "test" });
  Testing.assertNothingIsNamedDashDash({
    name: "test",
    options: [{ name: "example" }],
    subcommands: [
      {
        name: "example",
        options: [{ name: "one" }],
      },
    ],
  });
  expect(() =>
    Testing.assertNothingIsNamedDashDash({
      name: "test",
      options: [{ name: "--" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertNothingIsNamedDashDash({
      name: "test",
      subcommands: [{ name: "--" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertNothingIsNamedDashDash({
      name: "test",
      parserDirectives: { flagsArePosixNoncompliant: true },
      options: [{ name: "--" }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertNothingIsNamedDashDash({
      name: "test",
      parserDirectives: { flagsArePosixNoncompliant: true },
      subcommands: [{ name: "--" }],
    }),
  ).toThrow();
});

test("testing: assertOptionArgSeparatorsHaveCharacters", () => {
  Testing.assertOptionArgSeparatorsHaveCharacters({ name: "test" });
  Testing.assertOptionArgSeparatorsHaveCharacters({
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    subcommands: [
      {
        name: "1",
        parserDirectives: { optionArgSeparators: [] },
      },
      {
        name: "2",
        parserDirectives: { optionArgSeparators: [":", "="] },
      },
    ],
  });
  expect(() =>
    Testing.assertOptionArgSeparatorsHaveCharacters({
      name: "test",
      parserDirectives: { optionArgSeparators: "" },
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionArgSeparatorsHaveCharacters({
      name: "test",
      parserDirectives: { optionArgSeparators: [":", ""] },
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionArgSeparatorsHaveCharacters({
      name: "test",
      subcommands: [
        {
          name: "example",
          parserDirectives: { optionArgSeparators: "" },
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionArgSeparatorsHaveCharacters({
      name: "test",
      subcommands: [
        {
          name: "example",
          parserDirectives: { optionArgSeparators: [":", ""] },
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertPlusMinusOptionsTakeOneArg", () => {
  Testing.assertPlusMinusOptionsTakeOneArg({ name: "test" });
  Testing.assertPlusMinusOptionsTakeOneArg({
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "-", args: {} },
    ],
  });
  Testing.assertPlusMinusOptionsTakeOneArg({
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "+" }, { name: "-" }],
  });
  for (const option of [
    { name: "+" },
    { name: "-" },
    { name: "+", args: [{}, { isOptional: true }] },
    { name: "-", args: [{}, { isOptional: true }] },
  ] satisfies Option[]) {
    expect(() =>
      Testing.assertPlusMinusOptionsTakeOneArg({
        name: "test",
        options: [option],
      }),
    ).toThrow();
  }
});

test("testing: assertNamesHaveNoExtraWhitespace", () => {
  Testing.assertNamesHaveNoExtraWhitespace({ name: "test" });
  Testing.assertNamesHaveNoExtraWhitespace({
    name: "test",
    options: [{ name: "--option", args: { name: "arg" } }],
    args: { name: "no space" },
    subcommands: [
      {
        name: "subcommand",
        options: [{ name: "option" }],
        args: [{ name: "no additional space" }, {}],
      },
    ],
  });
  for (const spec of [
    { name: "test " },
    { name: " test" },
    { name: "test", options: [{ name: "--option " }] },
    { name: "test", options: [{ name: "--option", args: { name: "arg " } }] },
    { name: "test", subcommands: [{ name: "example " }] },
    {
      name: "test",
      subcommands: [{ name: "example", options: [{ name: " -o" }] }],
    },
  ] satisfies Spec[]) {
    expect(() => Testing.assertNamesHaveNoExtraWhitespace(spec)).toThrow();
  }
});

test("testing: assertEverythingHasDescription", () => {
  Testing.assertEverythingHasDescription({
    name: "test",
    description: "test",
  });
  Testing.assertEverythingHasDescription({
    name: "test",
    description: "test",
    options: [{ name: "--option", description: "test", args: { name: "arg" } }],
    args: {},
    subcommands: [
      {
        name: "subcommand",
        description: "test",
        options: [{ name: "option", description: "option" }],
        args: {},
      },
    ],
  });
  expect(() => Testing.assertEverythingHasDescription({ name: "test" })).toThrow();
  expect(() =>
    Testing.assertEverythingHasDescription({
      name: "test",
      description: "test",
      options: [{ name: "test" }],
    }),
  ).toThrow();
});

test("testing: assertDescriptionLineLengthUnder69", () => {
  Testing.assertDescriptionLineLengthUnder69({ name: "test" });
  Testing.assertDescriptionLineLengthUnder69({
    name: "test",
    description: "test",
    options: [{ name: "--option", description: "test", args: { name: "arg" } }],
    args: {},
    subcommands: [
      {
        name: "subcommand",
        description: "test",
        options: [{ name: "option", description: "option" }],
        args: {},
      },
    ],
  });
  Testing.assertDescriptionLineLengthUnder69({
    name: "test",
    description: "a".repeat(68),
  });
  expect(() =>
    Testing.assertDescriptionLineLengthUnder69({
      name: "test",
      description: "a".repeat(69),
    }),
  ).toThrow();
  expect(() =>
    Testing.assertDescriptionLineLengthUnder69({
      name: "test",
      options: [{ name: "test", description: "a".repeat(69) }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertDescriptionLineLengthUnder69({
      name: "test",
      subcommands: [{ name: "test", description: "a".repeat(69) }],
    }),
  ).toThrow();
});

test("testing: assertRequiresSeparatorTakesOneArg", () => {
  Testing.assertRequiresSeparatorTakesOneArg({ name: "test" });
  Testing.assertRequiresSeparatorTakesOneArg({
    name: "test",
    options: [{ name: "option" }, { name: "option", args: {} }, { name: "option", args: [{}, {}] }],
  });
  Testing.assertRequiresSeparatorTakesOneArg({
    name: "test",
    options: [
      { name: "1", requiresSeparator: true, args: {} },
      { name: "2", requiresSeparator: "=", args: {} },
    ],
  });
  const options: Option[] = [
    { name: "option", requiresSeparator: true },
    { name: "option", requiresSeparator: "=" },
    { name: "option", requiresSeparator: true, args: [{}, {}] },
    { name: "option", requiresSeparator: "=", args: [{}, {}] },
    { name: "option", requiresSeparator: "=", args: { isVariadic: true } },
    {
      name: "option",
      requiresSeparator: "=",
      args: [{}, { isOptional: true }],
    },
  ];
  for (const option of options) {
    expect(() =>
      Testing.assertRequiresSeparatorTakesOneArg({
        name: "test",
        options: [option],
      }),
    ).toThrow();
  }
});

test("testing: assertCommonOptionsArePersistent", () => {
  Testing.assertCommonOptionsArePersistent({ name: "test" });
  Testing.assertCommonOptionsArePersistent({
    name: "test",
    options: [{ name: "option" }],
  });
  Testing.assertCommonOptionsArePersistent({
    name: "test",
    options: [{ name: "a" }],
    subcommands: [{ name: "subcommand", options: [{ name: "b" }] }],
  });
  Testing.assertCommonOptionsArePersistent({
    name: "test",
    options: [{ name: "a" }],
    subcommands: [
      { name: "subcommand", options: [{ name: "a" }] },
      {
        name: "another",
      },
    ],
  });
  Testing.assertCommonOptionsArePersistent({
    name: "test",
    options: [{ name: "a", isPersistent: true }],
    subcommands: [{ name: "subcommand" }],
  });
  Testing.assertCommonOptionsArePersistent({
    name: "test",
    options: [{ name: "a" }],
    subcommands: [
      {
        name: "subcommand",
        options: [{ name: "a" }],
        subcommands: [{ name: "another" }],
      },
    ],
  });
  expect(() =>
    Testing.assertCommonOptionsArePersistent({
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        { name: "subcommand", options: [{ name: "a" }] },
        { name: "another", options: [{ name: "a" }] },
      ],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertCommonOptionsArePersistent({
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        {
          name: "subcommand",
          options: [{ name: "a" }],
          subcommands: [{ name: "another", options: [{ name: "a" }] }],
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertOptionNameReferencesExist", () => {
  Testing.assertOptionNameReferencesExist({ name: "test" });
  Testing.assertOptionNameReferencesExist({
    name: "test",
    options: [{ name: "a" }, { name: "b" }],
  });
  Testing.assertOptionNameReferencesExist({
    name: "test",
    options: [
      { name: "a", dependsOn: ["b"] },
      { name: "b", exclusiveOn: ["a"] },
    ],
  });
  Testing.assertOptionNameReferencesExist({
    name: "test",
    options: [{ name: "a", isPersistent: true }],
    subcommands: [
      {
        name: "cmd",
        options: [
          { name: "b", dependsOn: ["a"] },
          { name: "c", exclusiveOn: ["b"] },
        ],
      },
    ],
  });
  expect(() =>
    Testing.assertOptionNameReferencesExist({
      name: "test",
      options: [{ name: "a", dependsOn: ["b"] }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionNameReferencesExist({
      name: "test",
      options: [{ name: "a", exclusiveOn: ["b"] }],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionNameReferencesExist({
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        {
          name: "cmd",
          options: [{ name: "b", dependsOn: ["a"] }],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertOptionNameReferencesExist({
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        {
          name: "cmd",
          options: [{ name: "b", exclusiveOn: ["a"] }],
        },
      ],
    }),
  ).toThrow();
});

test("testing: assertPrefixMatchCommandsHaveNoArguments", () => {
  Testing.assertPrefixMatchCommandsHaveNoArguments({ name: "test" });
  Testing.assertPrefixMatchCommandsHaveNoArguments({
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "something" }, { name: "another" }],
  });
  Testing.assertPrefixMatchCommandsHaveNoArguments({
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    args: {},
  });
  Testing.assertPrefixMatchCommandsHaveNoArguments({
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "test", args: { name: "args" } }],
  });
  expect(() =>
    Testing.assertPrefixMatchCommandsHaveNoArguments({
      name: "test",
      parserDirectives: { subcommandsMatchUniquePrefix: true },
      subcommands: [
        {
          name: "test",
          args: { name: "args" },
          subcommands: [{ name: "test" }],
        },
      ],
    }),
  ).toThrow();
  expect(() =>
    Testing.assertPrefixMatchCommandsHaveNoArguments({
      name: "test",
      parserDirectives: { subcommandsMatchUniquePrefix: true },
      args: { name: "test" },
      subcommands: [{ name: "test" }],
    }),
  ).toThrow();
});

test("testing: testSpec runs all default steps with sentence names", async () => {
  const steps = await collectSteps(validSpec());
  expect(steps).toEqual([
    "Required arguments don't follow optional arguments",
    "Repeatable options don't have arguments",
    "Repeatable options that are numbers are integers greater than 1",
    "Long option names don't start with a single dash",
    "Option names all start with dashes",
    "Options have locally unique names",
    "Options don't shadow persistent options",
    "Different options on a subcommand and its parents have different names",
    "Subcommands have locally unique names",
    "Nothing is named '--'",
    "Option arg separators are not an empty string",
    "Options named '-' or '+' take exactly one argument",
    "Names have no extra leading or trailing whitespace",
    "Everything has a description",
    "Each line in descriptions is less than or equal to 68 characters",
    "Options with `requiresSeparator` take exactly one argument",
    "Common options are not defined on every subcommand",
    "References to other options by name are valid",
    "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
  ]);
});

test("testing: testSpec supports function-style step names", async () => {
  const steps = await collectSteps(validSpec(), { namingStyle: "function" });
  expect(steps).toContain("assertRequiredArgumentsDoNotFollowOptionalArguments");
  expect(steps).toContain("assertPrefixMatchCommandsHaveNoArguments");
  expect(steps).not.toContain("Required arguments don't follow optional arguments");
});

test("testing: testSpec config skips optional checks", async () => {
  await expect(
    collectSteps(
      {
        ...validSpec(),
        options: [{ name: "--global", description: "Global option.", isPersistent: true }],
        subcommands: [
          {
            name: "run",
            description: "Run.",
            options: [{ name: "--global", description: "Shadows global." }],
          },
          {
            name: "check",
            description: "Check.",
          },
        ],
      },
      { allowShadowingPersistentOptions: true },
    ),
  ).resolves.not.toContain("Options don't shadow persistent options");

  await expect(
    collectSteps(
      {
        name: "demo",
        options: [{ name: "--option" }],
      },
      { allowNoDescription: true },
    ),
  ).resolves.not.toContain("Everything has a description");

  await expect(
    collectSteps(
      {
        ...validSpec(),
        description: "a".repeat(69),
      },
      { allowLongDescriptionLines: true },
    ),
  ).resolves.not.toContain("Each line in descriptions is less than or equal to 68 characters");

  await expect(
    collectSteps(
      {
        ...validSpec(),
        parserDirectives: { subcommandsMatchUniquePrefix: true },
        args: { name: "value" },
        subcommands: [{ name: "run", description: "Run." }],
      },
      { allowMatchingSubcommandPrefixAndArgs: true },
    ),
  ).resolves.not.toContain(
    "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
  );
});

test("testing: test and testSpec are aliases", () => {
  expect(Testing.testSpec).toBe(Testing.test);
});

function validSpec(): Spec {
  return {
    name: "demo",
    description: "Demo.",
    options: [{ name: "--option", description: "Option." }],
    subcommands: [{ name: "run", description: "Run." }],
  };
}

async function collectSteps(spec: Spec, config: Testing.TestOptions = {}): Promise<string[]> {
  const steps: string[] = [];
  await Testing.testSpec(
    spec,
    config,
  )({
    async step(name, fn) {
      steps.push(name);
      await fn();
    },
  });
  return steps;
}
