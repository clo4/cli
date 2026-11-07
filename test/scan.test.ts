import { expect, test } from "vitest";

import { InvalidOptionArg, UnknownOption } from "../src/errors.js";
import { parse, scan } from "../src/parse.js";
import type { Option, Spec, Subcommand } from "../src/types.js";
import { map } from "./helpers.js";

// How each input token is classified, checked through the result of `parse`.

test("scan: empty", () => {
  expect(parse([], { name: "test" }).args).toEqual([]);
});

test("scan: args", () => {
  expect(parse(["one", "two"], { name: "test", args: { isVariadic: true } }).args).toEqual(["one", "two"]);
});

test("scan: arg separator", () => {
  const result = parse(["one", "--", "two"], { name: "test", args: { isVariadic: true } });
  expect(result.args).toEqual(["one", "two"]);
  expect(result.argSeparatorIndex).toBe(1);
});

test("scan: known option", () => {
  const spec: Spec = { name: "test", options: [{ name: "--option" }] };
  expect(parse(["--option"], spec).options).toEqual(map({ "--option": [] }));
});

test("scan: known option with inline arg", () => {
  const spec: Spec = { name: "test", options: [{ name: "--option", args: {} }] };
  expect(parse(["--option=abc"], spec).options).toEqual(map({ "--option": ["abc"] }));
});

test("scan: an inline arg for an option without args is rejected", () => {
  const spec: Spec = { name: "test", options: [{ name: "--option" }] };
  expect(() => parse(["--option=abc"], spec)).toThrow(InvalidOptionArg);
});

test("scan: unknown option", () => {
  expect(() => parse(["--option"], { name: "test" })).toThrow(UnknownOption);
  expect(() => parse(["--option=abc"], { name: "test" })).toThrow(UnknownOption);
});

test("scan: posix-noncompliant options with unknown option", () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
  };
  expect(parse(["arg", "--option"], spec).args).toEqual(["arg", "--option"]);
});

test("scan: posix-noncompliant options with known option", () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "option", args: { isOptional: true } }],
  };
  const result = parse(["arg", "option", "option=value"], spec);
  expect(result.args).toEqual(["arg"]);
  expect(result.options).toEqual(map({ option: ["value"] }));
});

test("scan: option arg separators", () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: {
      optionArgSeparators: ["=", ":"],
      flagsArePosixNoncompliant: true,
    },
    options: [{ name: "option", args: { isOptional: true } }],
  };
  const result = parse(["arg", "option", "option:value"], spec);
  expect(result.args).toEqual(["arg"]);
  expect(result.options).toEqual(map({ option: ["value"] }));
});

test("scan: anonymous options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-", args: {} }, { name: "+", args: {} }, { name: "-x" }, { name: "-y" }],
  };
  expect(parse(["-123", "+abc", "-xy"], spec).options).toEqual(
    map({ "-": ["123"], "+": ["abc"], "-x": [], "-y": [] }),
  );
});

test("scan: chained options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-x" }, { name: "-y" }, { name: "-z" }, { name: "+x" }, { name: "+y" }, { name: "+z" }],
  };
  expect([...parse(["-xyz", "+xyz"], spec).options.keys()]).toEqual(["-x", "-y", "-z", "+x", "+y", "+z"]);
});

test("scan: subcommand", () => {
  const cmd: Subcommand = { name: "cmd", options: [{ name: "--option" }] };
  const spec: Spec = { name: "test", subcommands: [cmd] };
  const result = parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, cmd]);
  expect(result.options).toEqual(map({ "--option": [] }));
});

test("scan: persistent options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  const result = parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
  expect(result.options).toEqual(map({ "--option": [] }));
});

test("scan: optionsMustPrecedeArguments", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd", args: { isVariadic: true } }],
  };
  const result = parse(["cmd", "--option", "arg", "--option"], spec);
  expect(result.options).toEqual(map({ "--option": [] }));
  expect(result.args).toEqual(["arg", "--option"]);
});

test("scan: subcommandsMatchUniquePrefix", () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: ["long-name", "name"] },
      { name: "long-time" },
      { name: ["abc-def", "abc-xyz"] },
      { name: "abc" },
    ],
  };
  const commands = spec.subcommands!;
  expect(parse(["long-name"], spec).path[1]).toBe(commands[0]);
  expect(parse(["abc"], spec).path[1]).toBe(commands[3]);
  expect(parse(["abc-"], spec).path[1]).toBe(commands[2]);
  // An ambiguous prefix is an argument.
  expect(parse(["long-"], spec).args).toEqual(["long-"]);
  expect(parse(["long-n"], spec).path[1]).toBe(commands[0]);
  expect(parse(["n"], spec).path[1]).toBe(commands[0]);
});

test("scan: a separate option value belongs to the option", () => {
  const spec: Spec = { name: "test", args: {}, options: [{ name: "--option", args: {} }] };
  const result = parse(["--option", "abc", "def"], spec);
  expect(result.options).toEqual(map({ "--option": ["abc"] }));
  expect(result.args).toEqual(["def"]);
});

// Lenient mode, which completion uses, never throws and keeps reading.

test("scan: lenient mode skips unknown options", () => {
  const spec: Spec = { name: "test", args: {}, options: [{ name: "-a" }] };
  const result = scan(["--nope", "--nope=value", "-zaz", "arg"], spec, false);
  expect(result.options).toEqual(map({ "-a": [] }));
  expect(result.args).toEqual(["arg"]);
});

test("scan: lenient mode keeps arguments past the maximum", () => {
  const result = scan(["one", "two", "--", "three"], { name: "test" }, false);
  expect(result.args).toEqual(["one", "two", "three"]);
  expect(result.argSeparatorIndex).toBe(2);
});

test("scan: lenient mode ignores a value attached to an option without args", () => {
  const spec: Spec = { name: "test", options: [{ name: "--flag" }] };
  const result = scan(["--flag=value"], spec, false);
  expect(result.options).toEqual(map({ "--flag": [] }));
  expect(result.args).toEqual([]);
});

test("scan: lenient mode ignores missing and repeated option values", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--out", args: {} },
      { name: "-v", isRepeatable: 1 },
    ],
  };
  const result = scan(["-v", "-v", "--out"], spec, false);
  expect(result.options.get("-v")).toEqual(["", ""]);
  expect(result.options.get("--out")).toEqual([]);
  expect(result.seenOptions).toEqual([spec.options![1], spec.options![1], spec.options![0]]);
});

test("scan: lenient mode doesn't require options or arguments", () => {
  const spec: Spec = {
    name: "test",
    args: {},
    options: [{ name: "--req", isRequired: true }],
  };
  expect(() => scan([], spec, false)).not.toThrow();
  expect(() => scan([], spec, true)).toThrow();
});

test("scan: an option with room for values is reported as open", () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect(scan(["--tags"], spec, false).openOption).toEqual({ option, valueCount: 0 });
  expect(scan(["--tags", "a", "b"], spec, false).openOption).toEqual({ option, valueCount: 2 });
  // An attached value is the option's only value.
  expect(scan(["--tags=a"], spec, false).openOption).toBeNull();
});

test("scan: '--' closes an open option", () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect(scan(["--tags", "a", "--"], spec, false).openOption).toBeNull();
  expect(scan(["--tags", "--", "b"], spec, false).openOption).toBeNull();
});

test("scan: an option that requires a separator is never left open", () => {
  const option: Option = { name: "--option", args: {}, requiresSeparator: true };
  const spec: Spec = { name: "test", options: [option] };
  expect(scan(["--option"], spec, false).openOption).toBeNull();
});

test("scan: reports the directives in effect for the final command", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: {
      optionArgSeparators: [":", "="],
      optionsMustPrecedeArguments: true,
      subcommandsMatchUniquePrefix: true,
    },
    subcommands: [
      {
        name: "sub",
        parserDirectives: { optionsMustPrecedeArguments: false, flagsArePosixNoncompliant: true },
      },
    ],
  };
  expect(scan([], spec, false).directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: true,
    subcommandsMatchUniquePrefix: true,
  });
  expect(scan(["sub"], spec, false).directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: true,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: true,
  });
});

test("scan: lenient mode skips unknown characters in a chain and keeps the rest", () => {
  const spec: Spec = { name: "test", options: [{ name: "-a" }, { name: "-b" }] };
  expect(scan(["-axb"], spec, false).options).toEqual(map({ "-a": [], "-b": [] }));
});
