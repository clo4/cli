import { expect, test } from "vitest";

import {
  $arg,
  $argSeparator,
  $option,
  $optionArg,
  $subcommand,
  $unknownOption,
  analyze,
} from "../src/analyze.js";

function expectTokens(result: ReturnType<typeof analyze>, tokens: unknown[]) {
  expect(result.tokens).toEqual(tokens);
}

test("analyze: empty", () => {
  expectTokens(analyze([], { name: "test" }), []);
});

test("analyze: args", () => {
  expectTokens(analyze(["one", "two"], { name: "test" }), [
    $arg(0, 0, 3, "one"),
    $arg(1, 0, 3, "two"),
  ]);
});

test("analyze: arg separator", () => {
  expectTokens(analyze(["one", "--", "two"], { name: "test" }), [
    $arg(0, 0, 3, "one"),
    $argSeparator(1, 0, 2, "--"),
    $arg(2, 0, 3, "two"),
  ]);
});

test("analyze: known option", () => {
  const spec = { name: "test", options: [{ name: "--option" }] };
  expectTokens(analyze(["--option"], spec), [$option(0, 0, 8, "--option", spec.options[0])]);
});

test("analyze: known option with inline arg", () => {
  const spec = { name: "test", options: [{ name: "--option" }] };
  expectTokens(analyze(["--option=abc"], spec), [
    $option(0, 0, 8, "--option", spec.options[0]),
    $optionArg(0, 9, 12, "abc", "--option", "="),
  ]);
});

test("analyze: unknown option", () => {
  expectTokens(analyze(["--option"], { name: "test" }), [$unknownOption(0, 0, 8, "--option", [])]);
});

test("analyze: unknown option with inline arg", () => {
  expectTokens(analyze(["--option=abc"], { name: "test" }), [
    $unknownOption(0, 0, 8, "--option", []),
    $optionArg(0, 9, 12, "abc", "--option", "="),
  ]);
});

test("analyze: posix-noncompliant options with unknown option", () => {
  const spec = {
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
  };
  expectTokens(analyze(["arg", "--option"], spec), [
    $arg(0, 0, 3, "arg"),
    $arg(1, 0, 8, "--option"),
  ]);
});

test("analyze: posix-noncompliant options with known option", () => {
  const spec = {
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "option" }],
  };
  expectTokens(analyze(["arg", "option", "option=value"], spec), [
    $arg(0, 0, 3, "arg"),
    $option(1, 0, 6, "option", spec.options[0]),
    $option(2, 0, 6, "option", spec.options[0]),
    $optionArg(2, 7, 12, "value", "option", "="),
  ]);
});

test("analyze: option arg separators", () => {
  const spec = {
    name: "test",
    parserDirectives: {
      optionArgSeparators: ["=", ":"],
      flagsArePosixNoncompliant: true,
    },
    options: [{ name: "option" }],
  };
  expectTokens(analyze(["arg", "option", "option:value"], spec), [
    $arg(0, 0, 3, "arg"),
    $option(1, 0, 6, "option", spec.options[0]),
    $option(2, 0, 6, "option", spec.options[0]),
    $optionArg(2, 7, 12, "value", "option", ":"),
  ]);
});

test("analyze: anonymous options", () => {
  const spec = {
    name: "test",
    options: [{ name: "-", args: {} }, { name: "+", args: {} }, { name: "-x" }, { name: "-y" }],
  };
  expectTokens(analyze(["-123", "+abc", "-xy"], spec), [
    $option(0, 0, 1, "-", spec.options[0]),
    $optionArg(0, 1, 4, "123", "-", ""),
    $option(1, 0, 1, "+", spec.options[1]),
    $optionArg(1, 1, 4, "abc", "+", ""),
    $option(2, 1, 2, "-x", spec.options[2]),
    $option(2, 2, 3, "-y", spec.options[3]),
  ]);
});

test("analyze: chained options", () => {
  const spec = {
    name: "test",
    options: [
      { name: "-x" },
      { name: "-y" },
      { name: "-z" },
      { name: "+x" },
      { name: "+y" },
      { name: "+z" },
    ],
  };
  expectTokens(analyze(["-xyz", "+xyz"], spec), [
    $option(0, 1, 2, "-x", spec.options[0]),
    $option(0, 2, 3, "-y", spec.options[1]),
    $option(0, 3, 4, "-z", spec.options[2]),
    $option(1, 1, 2, "+x", spec.options[3]),
    $option(1, 2, 3, "+y", spec.options[4]),
    $option(1, 3, 4, "+z", spec.options[5]),
  ]);
});

test("analyze: subcommand", () => {
  const spec = {
    name: "test",
    subcommands: [
      {
        name: "cmd",
        options: [{ name: "--option" }],
      },
    ],
  };
  expectTokens(analyze(["cmd", "--option"], spec), [
    $subcommand(0, 0, 3, "cmd", spec.subcommands[0]),
    $option(1, 0, 8, "--option", spec.subcommands[0].options[0]),
  ]);
});

test("analyze: persistent options", () => {
  const spec = {
    name: "test",
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  expectTokens(analyze(["cmd", "--option"], spec), [
    $subcommand(0, 0, 3, "cmd", spec.subcommands[0]),
    $option(1, 0, 8, "--option", spec.options[0]),
  ]);
});

test("analyze: option with args", () => {
  const spec = {
    name: "test",
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  expectTokens(analyze(["cmd", "--option"], spec), [
    $subcommand(0, 0, 3, "cmd", spec.subcommands[0]),
    $option(1, 0, 8, "--option", spec.options[0]),
  ]);
});

test("analyze: optionsMustPrecedeArguments", () => {
  const spec = {
    name: "test",
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  expectTokens(analyze(["cmd", "--option", "arg", "--option"], spec), [
    $subcommand(0, 0, 3, "cmd", spec.subcommands[0]),
    $option(1, 0, 8, "--option", spec.options[0]),
    $arg(2, 0, 3, "arg"),
    $arg(3, 0, 8, "--option"),
  ]);
});

test("analyze: subcommandsMatchUniquePrefix", () => {
  const spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: ["long-name", "name"] },
      { name: "long-time" },
      { name: ["abc-def", "abc-xyz"] },
      { name: "abc" },
    ],
  };

  expectTokens(analyze(["long-name"], spec), [
    $subcommand(0, 0, 9, "long-name", spec.subcommands[0]),
  ]);
  expectTokens(analyze(["abc"], spec), [$subcommand(0, 0, 3, "abc", spec.subcommands[3])]);
  expectTokens(analyze(["abc-"], spec), [$subcommand(0, 0, 4, "abc-", spec.subcommands[2])]);
  expectTokens(analyze(["long-"], spec), [$arg(0, 0, 5, "long-")]);
  expectTokens(analyze(["long-n"], spec), [$subcommand(0, 0, 6, "long-n", spec.subcommands[0])]);
  expectTokens(analyze(["n"], spec), [$subcommand(0, 0, 1, "n", spec.subcommands[0])]);
});
