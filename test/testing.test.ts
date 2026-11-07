import { expect, test } from "vitest";

import { help, helpCommand } from "../src/help.js";
import type { Option, Spec, Subcommand } from "../src/types.js";
import { parse } from "../src/parse.js";
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

test("testing: assertOptionNameReferencesExist checks a persistent option where it's used", () => {
  const spec = (reference: "dependsOn" | "exclusiveOn"): Subcommand => ({
    name: "test",
    options: [{ name: "--a", isPersistent: true, [reference]: ["--b"] }, { name: "--b" }],
    subcommands: [{ name: "sub" }],
  });
  expect(() => Testing.assertOptionNameReferencesExist(spec("dependsOn"))).toThrow(
    `In \`test sub\`, option \`test --a\` (index 0) depends on an option named "--b", which doesn't exist in its scope`,
  );
  expect(() => Testing.assertOptionNameReferencesExist(spec("exclusiveOn"))).toThrow(
    `In \`test sub\`, option \`test --a\` (index 0) is exclusive on an option named "--b", which doesn't exist in its scope`,
  );
  // The subcommand has its own '--b'.
  Testing.assertOptionNameReferencesExist({
    ...spec("dependsOn"),
    subcommands: [{ name: "sub", options: [{ name: "--b" }] }],
  });
});

test("testing: assertRequiredSeparatorsAreUsable", () => {
  const option = (requiresSeparator: true | string, isPersistent = false): Option => ({
    name: "--o",
    args: {},
    requiresSeparator,
    ...(isPersistent ? { isPersistent: true } : {}),
  });
  Testing.assertRequiredSeparatorsAreUsable({ name: "test", options: [option(true), option("=")] });
  Testing.assertRequiredSeparatorsAreUsable({
    name: "test",
    parserDirectives: { optionArgSeparators: [":", "="] },
    options: [option(":")],
  });
  // The separator isn't one the parser splits at.
  expect(() => Testing.assertRequiredSeparatorsAreUsable({ name: "test", options: [option(":")] })).toThrow(
    /`test --o` \(index 0\) requires the separator ':', but/,
  );
  // There are no separators at all.
  expect(() =>
    Testing.assertRequiredSeparatorsAreUsable({
      name: "test",
      parserDirectives: { optionArgSeparators: [] },
      options: [option(true)],
    }),
  ).toThrow(/`test --o` \(index 0\) requires a separator, but/);
  // A persistent option has to work in every subcommand that inherits it.
  expect(() =>
    Testing.assertRequiredSeparatorsAreUsable({
      name: "test",
      options: [option("=", true)],
      subcommands: [{ name: "sub", parserDirectives: { optionArgSeparators: ":" } }],
    }),
  ).toThrow(/In `test sub`, option `test --o` \(index 0\) requires the separator '=', but/);
});

test("testing: option name checks use the directives where a persistent option is used", () => {
  const spec: Subcommand = {
    name: "t",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "verbose", isPersistent: true }],
    subcommands: [{ name: "sub", parserDirectives: { flagsArePosixNoncompliant: false } }],
  };
  expect(() => Testing.assertOptionNamesStartWithDashes(spec)).toThrow(
    /^In `t sub`, option `t verbose` \(index 0\) doesn't start with a dash/,
  );
  // Without the subcommand turning it off, the option is fine everywhere.
  Testing.assertOptionNamesStartWithDashes({ ...spec, subcommands: [{ name: "sub" }] });
});

test("testing: subcommand messages name the subcommand once, with its index", () => {
  const spec: Subcommand = {
    name: "t",
    description: "root",
    subcommands: [
      { name: "a", description: "first" },
      { name: "bad ", description: "second" },
    ],
  };
  expect(() => Testing.assertNamesHaveNoExtraWhitespace(spec)).toThrow(
    "Subcommand `t bad ` (index 1) has a name with extra whitespace",
  );
  expect(() => Testing.assertEverythingHasDescription({ ...spec, subcommands: [{ name: "a" }] })).toThrow(
    "Subcommand `t a` (index 0) has no description",
  );
});

test("testing: assertOptionsDoNotMatchSubcommands", () => {
  Testing.assertOptionsDoNotMatchSubcommands({
    name: "t",
    options: [{ name: "--build", isPersistent: true }],
    subcommands: [{ name: "build" }],
  });
  expect(() =>
    Testing.assertOptionsDoNotMatchSubcommands({
      name: "t",
      options: [{ name: "--foo" }],
      subcommands: [{ name: "--foo" }],
    }),
  ).toThrow(
    "Option `t --foo` (index 0) has the name '--foo', which the parser reads as the subcommand `t --foo`",
  );
  // With prefix matching, a name that's a unique prefix of a subcommand's name matches it.
  expect(() =>
    Testing.assertOptionsDoNotMatchSubcommands({
      name: "t",
      parserDirectives: { flagsArePosixNoncompliant: true, subcommandsMatchUniquePrefix: true },
      options: [{ name: "bu", isPersistent: true }],
      subcommands: [{ name: "build", subcommands: [{ name: "bundle" }] }],
    }),
  ).toThrow("Option `t bu` (index 0) has the name 'bu', which the parser reads as the subcommand `t build`");
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

test("testing: assertPrefixMatchCommandsHaveNoArguments respects a subcommand turning prefix matching off", () => {
  Testing.assertPrefixMatchCommandsHaveNoArguments({
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      {
        name: "a",
        args: { name: "args" },
        parserDirectives: { subcommandsMatchUniquePrefix: false },
        subcommands: [{ name: "b" }],
      },
    ],
  });
});

test("testing: testSpec runs all default steps with sentence names", async () => {
  const steps = await collectSteps(validSpec());
  expect(steps).toEqual([
    "Required arguments don't follow optional arguments",
    "Repeatable options that are numbers are integers greater than 1",
    "Options have locally unique names",
    "Options don't shadow persistent options",
    "Different options on a subcommand and its parents have different names",
    "Subcommands have locally unique names",
    "The parser reads every name as the option or subcommand it names",
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

test("testing: assertNamesReadBack says what the parser reads a name as", () => {
  const check = Testing.assertNamesReadBack;
  const fails = (spec: Spec) => {
    try {
      check(spec);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("Expected the check to fail");
  };
  check({ name: "test", options: [{ name: ["-v", "--verbose"] }, { name: "-", args: {} }] });
  // A name with the separator in it is split there.
  expect(fails({ name: "test", options: [{ name: "--a=b" }] })).toBe(
    "Option `test --a=b` (index 0) has the name '--a=b', but the parser reads it as an argument, or an option that doesn't exist",
  );
  expect(fails({ name: "test", options: [{ name: "--a" }, { name: "--a=b" }] })).toMatch(
    /has the name '--a=b', but the parser reads it as the option `--a`$/,
  );
  // A long name with one dash is a chain of short options.
  expect(fails({ name: "test", options: [{ name: "-a" }, { name: "-b" }, { name: "-ab" }] })).toMatch(
    /has the name '-ab', but the parser reads it as the options `-a`, `-b`$/,
  );
  expect(fails({ name: "test", options: [{ name: "build" }] })).toMatch(/reads it as an argument/);
  expect(fails({ name: "test", options: [{ name: "--" }] })).toMatch(/reads it as the end of options, '--'$/);
  // A subcommand wins over an option, in every command the option reaches.
  expect(
    fails({
      name: "test",
      options: [{ name: "--x", isPersistent: true }],
      subcommands: [{ name: "sub", subcommands: [{ name: "--x" }] }],
    }),
  ).toMatch(
    /^In `test sub`, option `test --x` \(index 0\) has the name '--x', but the parser reads it as the subcommand `test sub --x`$/,
  );
  expect(fails({ name: "test", subcommands: [{ name: "a" }, { name: ["b", "a"] }] })).toMatch(
    /^Subcommand `test b\|a` \(index 1\) has the name 'a', but the parser reads it as the subcommand `test a`$/,
  );
});

test("testing: assertNamesReadBack checks that a required separator splits the option", () => {
  const check = Testing.assertNamesReadBack;
  check({ name: "test", options: [{ name: "--o", args: {}, requiresSeparator: true }] });
  check({
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--o", args: {}, requiresSeparator: ":" }],
  });
  expect(() =>
    check({
      name: "test",
      parserDirectives: { optionArgSeparators: ":" },
      options: [{ name: "--o", args: {}, requiresSeparator: "=" }],
    }),
  ).toThrow(
    "Option `test --o` (index 0) requires the separator '=', but the parser doesn't read '--o=value' as the option with a value",
  );
});

test("testing: test rejects an option name the parser splits at a separator", async () => {
  const spec: Spec = {
    name: "test",
    description: "Does things.",
    action: () => {},
    options: [{ name: "--a=b", description: "An option." }],
  };
  expect(() => parse(["--a=b"], spec)).toThrow();
  await expect(Testing.test(spec)()).rejects.toThrow("has the name '--a=b'");
});
