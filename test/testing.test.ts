import { expect, test } from "vitest";

import { help, helpCommand } from "../src/help.js";
import type { Option, Spec, Subcommand } from "../src/types.js";
import { parse } from "../src/parse.js";
import * as Testing from "../src/testing.js";
import { runSpecCheck } from "./helpers.js";

test("testing: run testSpec on helpCommand", async () => {
  await expect(Testing.testSpec(helpCommand)()).resolves.toBeUndefined();
});

test("testing: assertOptionsHaveLocallyUniqueNames", async () => {
  await runSpecCheck("assertOptionsHaveLocallyUniqueNames", { name: "test" });
  await runSpecCheck("assertOptionsHaveLocallyUniqueNames", {
    name: "test",
    options: [{ name: "one" }],
  });
  await runSpecCheck("assertOptionsHaveLocallyUniqueNames", {
    name: "test",
    options: [{ name: "one" }, { name: "two" }],
  });
  await expect(
    runSpecCheck("assertOptionsHaveLocallyUniqueNames", {
      name: "test",
      options: [{ name: "one" }, { name: "one" }],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionsHaveLocallyUniqueNames", {
      name: "test",
      options: [{ name: ["one", "one"] }],
    }),
  ).rejects.toThrow();
});

test("testing: assertOptionsHaveDifferentNamesFromParents", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertOptionsHaveDifferentNamesFromParents", spec);
  const withChild = (parent: Option, child: Option): Spec => ({
    name: "test",
    options: [parent],
    subcommands: [{ name: "sub", options: [child] }],
  });

  // Different options with exactly the same names
  await expect(check(withChild({ name: "-C", args: {} }, { name: "-C" }))).rejects.toThrow();
  await expect(
    check(withChild({ name: ["-C", "--cd"], args: {} }, { name: ["--cd", "-C"] })),
  ).rejects.toThrow();
  await expect(
    check({
      name: "test",
      options: [{ name: "-C", args: {} }],
      subcommands: [{ name: "mid", subcommands: [{ name: "leaf", options: [{ name: "-C" }] }] }],
    }),
  ).rejects.toThrow();

  // Every name of the parent's option is the child's too
  await expect(
    check(withChild({ name: "-C", args: { name: "dir" } }, { name: ["-C", "-D"] })),
  ).rejects.toThrow(
    "Option `test sub -C|-D` (index 0) has every name of a different option, `test -C`, so the parent's value can't be read. Add a name that only the parent's option uses, or give each a `ref`.",
  );
  // Every name of the child's option is the parent's too
  await expect(check(withChild({ name: ["-C", "--cd"], args: {} }, { name: "-C" }))).rejects.toThrow(
    "Option `test sub -C` (index 0) only has names of a different option, `test -C|--cd`, so it can't tell whether it was used. Add a name that only the subcommand's option uses, or give each a `ref`.",
  );
  // Same structure doesn't make options with different names one option
  await expect(check(withChild({ name: "--verbose" }, { name: ["-v", "--verbose"] }))).rejects.toThrow();

  // Each option has a name of its own
  await check(withChild({ name: ["-C", "--cd"], args: {} }, { name: ["-C", "--moved"] }));
  await check(withChild({ name: "-a" }, { name: "-b" }));

  // Identical options
  const constant: Option = { name: ["-v", "--verbose"], description: "Print more." };
  await check(withChild(constant, constant));
  await check(withChild(constant, { ...constant }));
  await check(withChild(constant, { ...constant, name: ["--verbose", "-v"] }));
  await check(withChild(help, help));
  await check(withChild({ name: "--help", action() {} }, { name: "--help", action() {} }));
  await check(withChild({ name: "-t", args: { name: "tag" } }, { name: "-t", args: { name: "tag" } }));

  // Persistent parents belong to assertShadowingOptionsHaveRefs
  await check(withChild({ name: "-C", isPersistent: true, args: {} }, { name: "-C" }));

  // Same shape except for a property that changes the meaning
  await expect(
    check(withChild({ name: "-t", args: { name: "tag" } }, { name: "-t", args: { name: "tags" } })),
  ).rejects.toThrow();
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

test("testing: assertSubcommandsHaveLocallyUniqueNames", async () => {
  await runSpecCheck("assertSubcommandsHaveLocallyUniqueNames", { name: "test" });
  await runSpecCheck("assertSubcommandsHaveLocallyUniqueNames", {
    name: "test",
    subcommands: [{ name: "one" }, { name: "two" }],
  });
  await expect(
    runSpecCheck("assertSubcommandsHaveLocallyUniqueNames", {
      name: "test",
      subcommands: [{ name: "one" }, { name: "one" }],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertSubcommandsHaveLocallyUniqueNames", {
      name: "test",
      subcommands: [{ name: ["one", "one"] }],
    }),
  ).rejects.toThrow();
});

test("testing: assertShadowingOptionsHaveRefs", async () => {
  await runSpecCheck("assertShadowingOptionsHaveRefs", { name: "test" });
  await runSpecCheck("assertShadowingOptionsHaveRefs", {
    name: "test",
    options: [{ name: "one", isPersistent: true }, { name: "two" }],
  });
  await runSpecCheck("assertShadowingOptionsHaveRefs", {
    name: "test",
    options: [{ name: "one", isPersistent: true }],
    subcommands: [
      {
        name: "subcommand",
        options: [{ name: "two" }],
      },
    ],
  });
  await runSpecCheck("assertShadowingOptionsHaveRefs", {
    name: "test",
    options: [{ name: "one", isPersistent: true }, { name: "one" }],
  });
  await expect(
    runSpecCheck("assertShadowingOptionsHaveRefs", {
      name: "test",
      options: [{ name: "one", isPersistent: true }],
      subcommands: [
        {
          name: "subcommand",
          options: [{ name: "one" }],
        },
      ],
    }),
  ).rejects.toThrow();
});

test("testing: an option that shadows a persistent option passes once both have a ref", async () => {
  const shadowing = (parentRef?: string, childRef?: string): Subcommand => ({
    name: "test",
    options: [{ name: ["-v", "--verbose"], isPersistent: true, ref: parentRef }],
    subcommands: [{ name: "sub", options: [{ name: ["-v", "--version"], ref: childRef }] }],
  });
  await runSpecCheck("assertShadowingOptionsHaveRefs", shadowing("verbose", "version"));
  await expect(runSpecCheck("assertShadowingOptionsHaveRefs", shadowing("verbose"))).rejects.toThrow(
    /^Option `test sub -v\|--version` \(index 0\) shadows the name "-v" of a persistent option, .* Give it a `ref`/,
  );
  await expect(
    runSpecCheck("assertShadowingOptionsHaveRefs", shadowing(undefined, "version")),
  ).rejects.toThrow(
    /^Option `test -v\|--verbose` \(index 0\) has its name "-v" shadowed by .* Give it a `ref`/,
  );
});

test("testing: different options with the same names on a parent and a subcommand pass once both have a ref", async () => {
  const sameNames = (parentRef?: string, childRef?: string): Subcommand => ({
    name: "test",
    options: [{ name: "-C", args: {}, ref: parentRef }],
    subcommands: [{ name: "sub", options: [{ name: "-C", ref: childRef }] }],
  });
  await runSpecCheck("assertOptionsHaveDifferentNamesFromParents", sameNames("dir", "color"));
  await expect(runSpecCheck("assertOptionsHaveDifferentNamesFromParents", sameNames("dir"))).rejects.toThrow(
    /give each a `ref`/,
  );
});

test("testing: assertRefsAreUnique", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertRefsAreUnique", spec);
  await check({ name: "test" });
  await check({
    name: "test",
    options: [{ name: "-v", isPersistent: true, ref: "verbose" }],
    subcommands: [{ name: "sub", options: [{ name: "-v", ref: "version" }] }],
  });
  // The same option object in two places is one option.
  const shared = { name: "-v", ref: "verbose" } as const;
  await check({ name: "test", options: [shared], subcommands: [{ name: "sub", options: [shared] }] });
  // Sibling commands are never on one command line, so their options can have the same ref:
  // `git -C dir switch -C branch` and `git -C dir branch -C old new`.
  await check({
    name: "git",
    options: [{ name: "-C", args: { name: "path" }, ref: "directory" }],
    subcommands: [
      { name: "switch", options: [{ name: "-C", args: { name: "branch" }, ref: "create" }] },
      { name: "branch", options: [{ name: "-C", ref: "create" }] },
    ],
  });

  await expect(
    check({
      name: "test",
      options: [{ name: "-v", isPersistent: true, ref: "v" }],
      subcommands: [{ name: "sub", options: [{ name: "-v", ref: "v" }] }],
    }),
  ).rejects.toThrow(
    /^Option `test sub -v` \(index 0\) has the ref "v", which Option `test -v` \(index 0\) has too/,
  );
  // Two levels apart is still one command line.
  await expect(
    check({
      name: "test",
      options: [{ name: "-C", ref: "c" }],
      subcommands: [{ name: "a", subcommands: [{ name: "b", options: [{ name: "-C", ref: "c" }] }] }],
    }),
  ).rejects.toThrow(/has the ref "c", which Option `test -C` \(index 0\) has too/);
  await expect(
    check({ name: "test", options: [{ name: "-v", ref: "--quiet" }, { name: "--quiet" }] }),
  ).rejects.toThrow(/has the ref "--quiet", which is a name of Option `test --quiet` \(index 1\)/);
  // A name below that is a ref above.
  await expect(
    check({
      name: "test",
      options: [{ name: "-v", ref: "quiet" }],
      subcommands: [{ name: "sub", options: [{ name: "quiet" }] }],
    }),
  ).rejects.toThrow(
    /^Option `test sub quiet` \(index 0\) has the name "quiet", which is the ref of Option `test -v`/,
  );
  await expect(check({ name: "test", options: [{ name: "-v", ref: "-v" }] })).rejects.toThrow(
    /has the ref "-v", which is one of its own names/,
  );
  await expect(check({ name: "test", options: [{ name: "-v", ref: "" }] })).rejects.toThrow(
    /has an empty `ref`/,
  );
});

test("testing: assertRefsAreNeeded", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertRefsAreNeeded", spec);
  await check({ name: "test", options: [{ name: "-v" }] });
  await check({
    name: "test",
    options: [{ name: ["-v", "--verbose"], isPersistent: true, ref: "verbose" }],
    subcommands: [{ name: "sub", options: [{ name: ["-v", "--version"], ref: "version" }] }],
  });
  // Two levels apart, and the option above isn't persistent.
  await check({
    name: "test",
    options: [{ name: "-C", ref: "dir" }],
    subcommands: [{ name: "a", subcommands: [{ name: "b", options: [{ name: "-C", ref: "color" }] }] }],
  });
  await expect(check({ name: "test", options: [{ name: "-v", ref: "verbose" }] })).rejects.toThrow(
    /^Option `test -v` \(index 0\) has a `ref`, but shares no name with an option on a command above or below it/,
  );
  // Options on sibling commands never meet on one command line.
  await expect(
    check({
      name: "test",
      subcommands: [
        { name: "a", options: [{ name: "-v", ref: "one" }] },
        { name: "b", options: [{ name: "-v", ref: "two" }] },
      ],
    }),
  ).rejects.toThrow(/has a `ref`, but shares no name/);
});

test("testing: assertRepeatableOptionsArePositiveIntegers", async () => {
  await runSpecCheck("assertRepeatableOptionsArePositiveIntegers", { name: "test" });
  await runSpecCheck("assertRepeatableOptionsArePositiveIntegers", {
    name: "test",
    options: [{ name: "one" }, { name: "two", isRepeatable: 2 }, { name: "three", isRepeatable: 2 }],
  });
  await runSpecCheck("assertRepeatableOptionsArePositiveIntegers", {
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
    await expect(
      runSpecCheck("assertRepeatableOptionsArePositiveIntegers", {
        name: "test",
        options: [{ name: "one", isRepeatable }],
      }),
    ).rejects.toThrow();
  }
});

test("testing: assertRequiredArgumentsDoNotFollowOptionalArguments", async () => {
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", { name: "test" });
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
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
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
    name: "test",
    args: {},
  });
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
    name: "test",
    args: { isOptional: true },
  });
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
    name: "test",
    args: [{}, {}],
  });
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
    name: "test",
    args: [{}, { isOptional: true }],
  });
  await runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
    name: "test",
    args: [{ isOptional: true }, { isOptional: true }],
  });
  await expect(
    runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
      name: "test",
      args: [{ isOptional: true }, {}],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertRequiredArgumentsDoNotFollowOptionalArguments", {
      name: "test",
      options: [{ name: "one", args: [{ isOptional: true }, {}] }],
    }),
  ).rejects.toThrow();
});

test("testing: assertOptionArgSeparatorsHaveCharacters", async () => {
  await runSpecCheck("assertOptionArgSeparatorsHaveCharacters", { name: "test" });
  await runSpecCheck("assertOptionArgSeparatorsHaveCharacters", {
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
  await expect(
    runSpecCheck("assertOptionArgSeparatorsHaveCharacters", {
      name: "test",
      parserDirectives: { optionArgSeparators: "" },
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionArgSeparatorsHaveCharacters", {
      name: "test",
      parserDirectives: { optionArgSeparators: [":", ""] },
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionArgSeparatorsHaveCharacters", {
      name: "test",
      subcommands: [
        {
          name: "example",
          parserDirectives: { optionArgSeparators: "" },
        },
      ],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionArgSeparatorsHaveCharacters", {
      name: "test",
      subcommands: [
        {
          name: "example",
          parserDirectives: { optionArgSeparators: [":", ""] },
        },
      ],
    }),
  ).rejects.toThrow();
});

test("testing: assertNamesReadBack checks options named + or -", async () => {
  await runSpecCheck("assertNamesReadBack", { name: "test" });
  await runSpecCheck("assertNamesReadBack", {
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "-", args: {} },
    ],
  });
  await runSpecCheck("assertNamesReadBack", {
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "+" }, { name: "-" }],
  });
  for (const option of [
    { name: "+" },
    { name: "-" },
    { name: "+", args: [{}, { isOptional: true }] },
    { name: "-", args: [{}, { isOptional: true }] },
    { name: "-", args: { isVariadic: true } },
  ] satisfies Option[]) {
    await expect(
      runSpecCheck("assertNamesReadBack", {
        name: "test",
        options: [option],
      }),
    ).rejects.toThrow();
  }
});

test("testing: assertNamesHaveNoExtraWhitespace", async () => {
  await runSpecCheck("assertNamesHaveNoExtraWhitespace", { name: "test" });
  await runSpecCheck("assertNamesHaveNoExtraWhitespace", {
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
    await expect(runSpecCheck("assertNamesHaveNoExtraWhitespace", spec)).rejects.toThrow();
  }
});

test("testing: assertEverythingHasDescription", async () => {
  await runSpecCheck("assertEverythingHasDescription", {
    name: "test",
    description: "test",
  });
  await runSpecCheck("assertEverythingHasDescription", {
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
  await expect(runSpecCheck("assertEverythingHasDescription", { name: "test" })).rejects.toThrow();
  await expect(
    runSpecCheck("assertEverythingHasDescription", {
      name: "test",
      description: "test",
      options: [{ name: "test" }],
    }),
  ).rejects.toThrow();
});

test("testing: assertDescriptionLineLengthUnder69", async () => {
  await runSpecCheck("assertDescriptionLineLengthUnder69", { name: "test" });
  await runSpecCheck("assertDescriptionLineLengthUnder69", {
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
  await runSpecCheck("assertDescriptionLineLengthUnder69", {
    name: "test",
    description: "a".repeat(68),
  });
  await expect(
    runSpecCheck("assertDescriptionLineLengthUnder69", {
      name: "test",
      description: "a".repeat(69),
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertDescriptionLineLengthUnder69", {
      name: "test",
      options: [{ name: "test", description: "a".repeat(69) }],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertDescriptionLineLengthUnder69", {
      name: "test",
      subcommands: [{ name: "test", description: "a".repeat(69) }],
    }),
  ).rejects.toThrow();
});

test("testing: assertNamesReadBack checks options that require a separator", async () => {
  await runSpecCheck("assertNamesReadBack", { name: "test" });
  // Without a required separator, an option can take several values.
  await runSpecCheck("assertNamesReadBack", {
    name: "test",
    options: [{ name: "--option" }, { name: "--o", args: {} }, { name: "--o2", args: [{}, {}] }],
  });
  await runSpecCheck("assertNamesReadBack", {
    name: "test",
    options: [
      { name: "--one", requiresSeparator: true, args: {} },
      { name: "--two", requiresSeparator: "=", args: { isOptional: true } },
      // Without arguments, the separator never comes up.
      { name: "--three", requiresSeparator: true },
    ],
  });
  const options: Option[] = [
    { name: "--o", requiresSeparator: true, args: [{}, {}] },
    { name: "--o", requiresSeparator: "=", args: [{}, {}] },
    { name: "--o", requiresSeparator: "=", args: { isVariadic: true } },
    {
      name: "--o",
      requiresSeparator: "=",
      args: [{}, { isOptional: true }],
    },
  ];
  for (const option of options) {
    await expect(
      runSpecCheck("assertNamesReadBack", {
        name: "test",
        options: [option],
      }),
    ).rejects.toThrow();
  }
});

test("testing: assertCommonOptionsArePersistent", async () => {
  await runSpecCheck("assertCommonOptionsArePersistent", { name: "test" });
  await runSpecCheck("assertCommonOptionsArePersistent", {
    name: "test",
    options: [{ name: "option" }],
  });
  await runSpecCheck("assertCommonOptionsArePersistent", {
    name: "test",
    options: [{ name: "a" }],
    subcommands: [{ name: "subcommand", options: [{ name: "b" }] }],
  });
  await runSpecCheck("assertCommonOptionsArePersistent", {
    name: "test",
    options: [{ name: "a" }],
    subcommands: [
      { name: "subcommand", options: [{ name: "a" }] },
      {
        name: "another",
      },
    ],
  });
  await runSpecCheck("assertCommonOptionsArePersistent", {
    name: "test",
    options: [{ name: "a", isPersistent: true }],
    subcommands: [{ name: "subcommand" }],
  });
  await runSpecCheck("assertCommonOptionsArePersistent", {
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
  await expect(
    runSpecCheck("assertCommonOptionsArePersistent", {
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        { name: "subcommand", options: [{ name: "a" }] },
        { name: "another", options: [{ name: "a" }] },
      ],
    }),
  ).rejects.toThrow();
  // Options with the same names in another order are the same option.
  await expect(
    runSpecCheck("assertCommonOptionsArePersistent", {
      name: "test",
      options: [{ name: ["a", "b"] }],
      subcommands: [
        { name: "subcommand", options: [{ name: ["b", "a"] }] },
        { name: "another", options: [{ name: ["a", "b"] }] },
      ],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertCommonOptionsArePersistent", {
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
  ).rejects.toThrow();
});

test("testing: assertOptionNameReferencesExist", async () => {
  await runSpecCheck("assertOptionNameReferencesExist", { name: "test" });
  await runSpecCheck("assertOptionNameReferencesExist", {
    name: "test",
    options: [{ name: "a" }, { name: "b" }],
  });
  await runSpecCheck("assertOptionNameReferencesExist", {
    name: "test",
    options: [
      { name: "a", dependsOn: ["b"] },
      { name: "b", exclusiveOn: ["a"] },
    ],
  });
  await runSpecCheck("assertOptionNameReferencesExist", {
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
  await expect(
    runSpecCheck("assertOptionNameReferencesExist", {
      name: "test",
      options: [{ name: "a", dependsOn: ["b"] }],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionNameReferencesExist", {
      name: "test",
      options: [{ name: "a", exclusiveOn: ["b"] }],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionNameReferencesExist", {
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        {
          name: "cmd",
          options: [{ name: "b", dependsOn: ["a"] }],
        },
      ],
    }),
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertOptionNameReferencesExist", {
      name: "test",
      options: [{ name: "a" }],
      subcommands: [
        {
          name: "cmd",
          options: [{ name: "b", exclusiveOn: ["a"] }],
        },
      ],
    }),
  ).rejects.toThrow();
});

test("testing: assertOptionNameReferencesExist checks a persistent option where it's used", async () => {
  const spec = (reference: "dependsOn" | "exclusiveOn"): Subcommand => ({
    name: "test",
    options: [{ name: "--a", isPersistent: true, [reference]: ["--b"] }, { name: "--b" }],
    subcommands: [{ name: "sub" }],
  });
  await expect(runSpecCheck("assertOptionNameReferencesExist", spec("dependsOn"))).rejects.toThrow(
    `In \`test sub\`, option \`test --a\` (index 0) depends on an option named "--b", which doesn't exist in its scope`,
  );
  await expect(runSpecCheck("assertOptionNameReferencesExist", spec("exclusiveOn"))).rejects.toThrow(
    `In \`test sub\`, option \`test --a\` (index 0) is exclusive on an option named "--b", which doesn't exist in its scope`,
  );
  // The subcommand has its own '--b'.
  await runSpecCheck("assertOptionNameReferencesExist", {
    ...spec("dependsOn"),
    subcommands: [{ name: "sub", options: [{ name: "--b" }] }],
  });
});

test("testing: subcommand messages name the subcommand once, with its index", async () => {
  const spec: Subcommand = {
    name: "t",
    description: "root",
    subcommands: [
      { name: "a", description: "first" },
      { name: "bad ", description: "second" },
    ],
  };
  await expect(runSpecCheck("assertNamesHaveNoExtraWhitespace", spec)).rejects.toThrow(
    "Subcommand `t bad ` (index 1) has a name with extra whitespace",
  );
  await expect(
    runSpecCheck("assertEverythingHasDescription", { ...spec, subcommands: [{ name: "a" }] }),
  ).rejects.toThrow("Subcommand `t a` (index 0) has no description");
});

test("testing: assertPrefixMatchCommandsHaveNoArguments", async () => {
  await runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", { name: "test" });
  await runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "something" }, { name: "another" }],
  });
  await runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    args: {},
  });
  await runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "test", args: { name: "args" } }],
  });
  await expect(
    runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
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
  ).rejects.toThrow();
  await expect(
    runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
      name: "test",
      parserDirectives: { subcommandsMatchUniquePrefix: true },
      args: { name: "test" },
      subcommands: [{ name: "test" }],
    }),
  ).rejects.toThrow();
});

test("testing: assertPrefixMatchCommandsHaveNoArguments respects a subcommand turning prefix matching off", async () => {
  await runSpecCheck("assertPrefixMatchCommandsHaveNoArguments", {
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
    "The parser can use every default",
    "Repeatable options that are numbers are integers greater than 1",
    "Options have locally unique names",
    "An option that shadows a persistent option has a ref, and so does the option it shadows",
    "Different options on a subcommand and its parents have different names",
    "No option a ref can meet on a command line has the same ref, or has it as a name",
    "Only an option that shares a name with an option above or below it has a ref",
    "Subcommands have locally unique names",
    "The parser reads every option and subcommand the way it's written",
    "Option arg separators are not an empty string",
    "Names have no extra leading or trailing whitespace",
    "Everything has a description",
    "Each line in descriptions is less than or equal to 68 characters",
    "Common options are not defined on every subcommand",
    "References to other options by name are valid",
    "Commands with `subcommandsMatchUniquePrefix` don't have arguments and subcommands",
  ]);
});

test("testing: testSpec supports function-style step names", async () => {
  // Users see these names in their test output.
  const steps = await collectSteps(validSpec(), { namingStyle: "function" });
  expect(steps).toEqual([
    "assertRequiredArgumentsDoNotFollowOptionalArguments",
    "assertDefaultsCanBeUsed",
    "assertRepeatableOptionsArePositiveIntegers",
    "assertOptionsHaveLocallyUniqueNames",
    "assertShadowingOptionsHaveRefs",
    "assertOptionsHaveDifferentNamesFromParents",
    "assertRefsAreUnique",
    "assertRefsAreNeeded",
    "assertSubcommandsHaveLocallyUniqueNames",
    "assertNamesReadBack",
    "assertOptionArgSeparatorsHaveCharacters",
    "assertNamesHaveNoExtraWhitespace",
    "assertEverythingHasDescription",
    "assertDescriptionLineLengthUnder69",
    "assertCommonOptionsArePersistent",
    "assertOptionNameReferencesExist",
    "assertPrefixMatchCommandsHaveNoArguments",
  ]);
});

test("testing: runSpecCheck rejects a name testSpec has no check for", async () => {
  await expect(runSpecCheck("assertPlusMinusOptionsTakeOneArg", validSpec())).rejects.toThrow(
    "testSpec has no spec check named assertPlusMinusOptionsTakeOneArg",
  );
});

test("testing: testSpec config skips optional checks", async () => {
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

test("testing: test and testSpec are aliases", async () => {
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

test("testing: assertNamesReadBack says what the parser reads a name as", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertNamesReadBack", spec);
  const fails = async (spec: Spec) => {
    try {
      await check(spec);
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("Expected the check to fail");
  };
  await check({ name: "test", options: [{ name: ["-v", "--verbose"] }, { name: "-", args: {} }] });
  // A name with the separator in it is split there.
  expect(await fails({ name: "test", options: [{ name: "--a=b" }] })).toBe(
    "Option `test --a=b` (index 0) has the name '--a=b', but the parser reads it as an option that doesn't exist",
  );
  expect(await fails({ name: "test", options: [{ name: "--a" }, { name: "--a=b" }] })).toMatch(
    /has the name '--a=b', but the parser reads it as the option `--a`$/,
  );
  // A long name with one dash is a chain of short options.
  expect(await fails({ name: "test", options: [{ name: "-a" }, { name: "-b" }, { name: "-ab" }] })).toMatch(
    /has the name '-ab', but the parser reads it as the options `-a`, `-b`$/,
  );
  expect(await fails({ name: "test", options: [{ name: "build" }] })).toMatch(/reads it as an argument/);
  expect(await fails({ name: "test", options: [{ name: "--" }] })).toMatch(
    /reads it as the end of options, '--'$/,
  );
  // A subcommand wins over an option, in every command the option reaches.
  expect(
    await fails({
      name: "test",
      options: [{ name: "--x", isPersistent: true }],
      subcommands: [{ name: "sub", subcommands: [{ name: "--x" }] }],
    }),
  ).toMatch(
    /^In `test sub`, option `test --x` \(index 0\) has the name '--x', but the parser reads it as the subcommand `test sub --x`$/,
  );
  expect(await fails({ name: "test", subcommands: [{ name: "a" }, { name: ["b", "a"] }] })).toMatch(
    /^Subcommand `test b\|a` \(index 1\) has the name 'a', but the parser reads it as the subcommand `test a`$/,
  );
});

test("testing: assertNamesReadBack checks that a required separator splits the option", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertNamesReadBack", spec);
  await check({ name: "test", options: [{ name: "--o", args: {}, requiresSeparator: true }] });
  await check({
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--o", args: {}, requiresSeparator: ":" }],
  });
  await expect(
    check({
      name: "test",
      parserDirectives: { optionArgSeparators: ":" },
      options: [{ name: "--o", args: {}, requiresSeparator: "=" }],
    }),
  ).rejects.toThrow(
    "Option `test --o` (index 0) is written '--o=<argument>', but '=' isn't one of the option arg separators there (':'). Add it to `parserDirectives.optionArgSeparators`.",
  );
  await expect(
    check({
      name: "test",
      parserDirectives: { optionArgSeparators: [] },
      options: [{ name: "--o", args: {}, requiresSeparator: true }],
    }),
  ).rejects.toThrow(
    "Option `test --o` (index 0) is written '--o=<argument>', but '=' isn't one of the option arg separators there (none). Add it to `parserDirectives.optionArgSeparators`.",
  );
});

test("testing: assertNamesReadBack writes each option with every value it takes", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertNamesReadBack", spec);
  await check({
    name: "test",
    options: [
      { name: "-", args: { name: "n" } },
      { name: "+", args: { name: "n" } },
    ],
  });
  await check({
    name: "test",
    options: [{ name: "--o", args: [{}, { isOptional: true }, { isVariadic: true }] }],
  });
  // The value is one no short option starts with, so it can follow '-'.
  await check({ name: "test", options: [{ name: "-", args: {} }, { name: "-0" }, { name: "-1" }] });
  // A value joined to the name is the option's only value.
  await expect(
    check({ name: "test", options: [{ name: "-", args: [{ name: "a" }, { name: "b" }] }] }),
  ).rejects.toThrow(
    "Option `test -` (index 0) is written '-<a> <b>', but in '-0 0' the parser reads '0' as an argument",
  );
  await expect(
    check({ name: "test", options: [{ name: "+", args: { name: "n", isVariadic: true } }] }),
  ).rejects.toThrow(
    "Option `test +` (index 0) is written '+<n>...', but in '+0 0' the parser reads '0' as an argument",
  );
  await expect(
    check({ name: "test", options: [{ name: "--o", args: [{}, {}], requiresSeparator: true }] }),
  ).rejects.toThrow(
    "Option `test --o` (index 0) is written '--o=<argument> <argument>', but in '--o=0 0' the parser reads '0' as an argument",
  );
  // An option named '-' without arguments can't be used, since '-' alone is an argument.
  await expect(check({ name: "test", options: [{ name: "-" }] })).rejects.toThrow(
    "Option `test -` (index 0) has the name '-', but the parser reads it as an argument",
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

test("testing: option messages start by naming the option the same way", async () => {
  await expect(
    runSpecCheck("assertRepeatableOptionsArePositiveIntegers", {
      name: "t",
      options: [{ name: "-v", isRepeatable: 1 }],
    }),
  ).rejects.toThrow(/^Option `t -v` \(index 0\) has its `isRepeatable` value set to 1/);
  await expect(
    runSpecCheck("assertShadowingOptionsHaveRefs", {
      name: "t",
      options: [{ name: "-v", isPersistent: true }],
      subcommands: [{ name: "sub", options: [{ name: "-q" }, { name: "-v" }] }],
    }),
  ).rejects.toThrow(
    /^Option `t sub -v` \(index 1\) shadows the name "-v" of a persistent option, Option `t -v` \(index 0\)/,
  );
  await expect(
    runSpecCheck("assertOptionsHaveDifferentNamesFromParents", {
      name: "t",
      options: [{ name: "-C", args: {} }],
      subcommands: [{ name: "sub", options: [{ name: "-C" }] }],
    }),
  ).rejects.toThrow(/^Option `t sub -C` \(index 0\) has the same names as a different option, `t -C`/);
  await expect(
    runSpecCheck("assertOptionNameReferencesExist", {
      name: "t",
      options: [{ name: "-a", dependsOn: ["-b"] }],
    }),
  ).rejects.toThrow(/^Option `t -a` \(index 0\) depends on an option named "-b"/);
});

test("testing: assertNamesReadBack rejects names the parser reads as something else", async () => {
  const check = (spec: Subcommand) => runSpecCheck("assertNamesReadBack", spec);
  const sep = (requiresSeparator: true | string, isPersistent = false): Option => ({
    name: "--o",
    args: {},
    requiresSeparator,
    ...(isPersistent ? { isPersistent: true } : {}),
  });
  const passes: Subcommand[] = [
    { name: "test", options: [{ name: "--one" }, { name: "-o" }, { name: "+o" }] },
    // POSIX-noncompliant options are matched by their whole name.
    { name: "test", parserDirectives: { flagsArePosixNoncompliant: true }, options: [{ name: "-one" }] },
    {
      name: "test",
      parserDirectives: { flagsArePosixNoncompliant: true },
      subcommands: [{ name: "example", options: [{ name: "one" }] }],
    },
    // An option is only read as a subcommand where that subcommand can be.
    { name: "t", options: [{ name: "--build", isPersistent: true }], subcommands: [{ name: "build" }] },
    { name: "test", options: [sep(true), sep("=")] },
    { name: "test", parserDirectives: { optionArgSeparators: [":", "="] }, options: [sep(":")] },
  ];
  for (const spec of passes) {
    await check(spec);
  }

  const fails: [Subcommand, string | RegExp][] = [
    [
      { name: "test", options: [{ name: "-one" }] },
      /'-one', but the parser reads it as an option that doesn't exist/,
    ],
    [{ name: "test", subcommands: [{ name: "e", options: [{ name: "+one" }] }] }, /^Option `test e \+one`/],
    [{ name: "test", options: [{ name: "one" }] }, /'one', but the parser reads it as an argument/],
    [{ name: "test", subcommands: [{ name: "--" }] }, /^Subcommand `test --` \(index 0\) has the name '--'/],
    [
      { name: "test", parserDirectives: { flagsArePosixNoncompliant: true }, options: [{ name: "--" }] },
      /reads it as the end of options, '--'$/,
    ],
    [
      { name: "t", options: [{ name: "--foo" }], subcommands: [{ name: "--foo" }] },
      "Option `t --foo` (index 0) has the name '--foo', but the parser reads it as the subcommand `t --foo`",
    ],
    // With prefix matching, a unique prefix of a subcommand's name enters it.
    [
      {
        name: "t",
        parserDirectives: { flagsArePosixNoncompliant: true, subcommandsMatchUniquePrefix: true },
        options: [{ name: "bu", isPersistent: true }],
        subcommands: [{ name: "build", subcommands: [{ name: "bundle" }] }],
      },
      "Option `t bu` (index 0) has the name 'bu', but the parser reads it as the subcommand `t build`",
    ],
    // A persistent option has to work with the directives of every command it reaches.
    [
      {
        name: "t",
        parserDirectives: { flagsArePosixNoncompliant: true },
        options: [{ name: "verbose", isPersistent: true }],
        subcommands: [{ name: "sub", parserDirectives: { flagsArePosixNoncompliant: false } }],
      },
      /^In `t sub`, option `t verbose` \(index 0\) has the name 'verbose'/,
    ],
    [{ name: "test", options: [sep(":")] }, /^Option `test --o` \(index 0\) is written '--o:<argument>'/],
    [
      { name: "test", parserDirectives: { optionArgSeparators: [] }, options: [sep(true)] },
      /^Option `test --o` \(index 0\) is written '--o=<argument>'/,
    ],
    [
      {
        name: "test",
        options: [sep("=", true)],
        subcommands: [{ name: "sub", parserDirectives: { optionArgSeparators: ":" } }],
      },
      /^In `test sub`, option `test --o` \(index 0\) is written '--o=<argument>'/,
    ],
  ];
  for (const [spec, message] of fails) {
    await expect(check(spec)).rejects.toThrow(message);
  }
});

test("testing: an option with a ref isn't a common option its subcommands copied", async () => {
  // Every subcommand has a -C, and each is a different option from the root's.
  await runSpecCheck("assertCommonOptionsArePersistent", {
    name: "git",
    options: [{ name: "-C", args: { name: "path" }, ref: "directory" }],
    subcommands: [
      { name: "switch", options: [{ name: "-C", ref: "create" }] },
      { name: "branch", options: [{ name: "-C", ref: "create" }] },
    ],
  });
  await expect(
    runSpecCheck("assertCommonOptionsArePersistent", {
      name: "git",
      options: [{ name: "-C" }],
      subcommands: [
        { name: "switch", options: [{ name: "-C" }] },
        { name: "branch", options: [{ name: "-C" }] },
      ],
    }),
  ).rejects.toThrow(/define the option once/);
});

test("testing: the spec checks follow a persistent subcommand into the commands that inherit it", async () => {
  // `cli a p --x=1` reads `--x=1` with the separators of `a`, which `p` under
  // the root never sees.
  const spec: Spec = {
    name: "cli",
    subcommands: [
      {
        name: "p",
        isPersistent: true,
        options: [{ name: "--x", args: { name: "v" }, requiresSeparator: "=" }],
      },
      { name: "a", parserDirectives: { optionArgSeparators: ":" } },
    ],
  };
  expect(() => parse(["p", "--x=1"], spec)).not.toThrow();
  expect(() => parse(["a", "p", "--x=1"], spec)).toThrow();
  await expect(runSpecCheck("assertNamesReadBack", spec)).rejects.toThrow(
    /^Option `cli a p --x` \(index 0\) is written '--x=<v>', but '=' isn't one of the option arg separators there \(':'\)/,
  );
});

test("testing: a persistent option listed again by a command that inherits it is reported as that", async () => {
  const verbose: Option = { name: "--verbose", isPersistent: true };
  const spec: Spec = { name: "cli", options: [verbose], subcommands: [{ name: "a", options: [verbose] }] };
  await expect(runSpecCheck("assertShadowingOptionsHaveRefs", spec)).rejects.toThrow(
    "Option `cli a --verbose` (index 0) is a persistent option that `cli a` already inherits, Option `cli --verbose` (index 0). Remove it from `cli a`.",
  );
});

test("testing: a persistent subcommand's option that shadows an option of a command inheriting it needs a ref", async () => {
  const spec: Spec = {
    name: "cli",
    subcommands: [
      { name: "p", isPersistent: true, options: [{ name: "-v" }] },
      { name: "a", options: [{ name: "-v", isPersistent: true }] },
    ] as const,
  };
  await expect(runSpecCheck("assertShadowingOptionsHaveRefs", spec)).rejects.toThrow(
    /^Option `cli a p -v` \(index 0\) shadows the name "-v" of a persistent option, Option `cli a -v` \(index 0\)/,
  );
});
