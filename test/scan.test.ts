import { expect, test } from "vitest";

import { InvalidOptionArg, UnknownOption } from "../src/errors.js";
import { parse, readHelpNames, readNext, readToken } from "../src/parse.js";
import type { Arg, Option, Spec, Subcommand } from "../src/types.js";
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
  expect(parse(["--option"], spec).options.options).toEqual(map({ "--option": [] }));
});

test("scan: known option with inline arg", () => {
  const spec: Spec = { name: "test", options: [{ name: "--option", args: {} }] };
  expect(parse(["--option=abc"], spec).options.options).toEqual(map({ "--option": ["abc"] }));
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
  expect(result.options.options).toEqual(map({ option: ["value"] }));
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
  expect(result.options.options).toEqual(map({ option: ["value"] }));
});

test("scan: anonymous options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-", args: {} }, { name: "+", args: {} }, { name: "-x" }, { name: "-y" }],
  };
  expect(parse(["-123", "+abc", "-xy"], spec).options.options).toEqual(
    map({ "-": ["123"], "+": ["abc"], "-x": [], "-y": [] }),
  );
});

test("scan: chained options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-x" }, { name: "-y" }, { name: "-z" }, { name: "+x" }, { name: "+y" }, { name: "+z" }],
  };
  expect([...parse(["-xyz", "+xyz"], spec).options.options.keys()]).toEqual([
    "-x",
    "-y",
    "-z",
    "+x",
    "+y",
    "+z",
  ]);
});

test("scan: subcommand", () => {
  const cmd: Subcommand = { name: "cmd", options: [{ name: "--option" }] };
  const spec: Spec = { name: "test", subcommands: [cmd] };
  const result = parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, cmd]);
  expect(result.options.options).toEqual(map({ "--option": [] }));
});

test("scan: persistent options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  const result = parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
  expect(result.options.options).toEqual(map({ "--option": [] }));
});

test("scan: optionsMustPrecedeArguments", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd", args: { isVariadic: true } }],
  };
  const result = parse(["cmd", "--option", "arg", "--option"], spec);
  expect(result.options.options).toEqual(map({ "--option": [] }));
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
  expect(result.options.options).toEqual(map({ "--option": ["abc"] }));
  expect(result.args).toEqual(["def"]);
});

// readNext reads leniently for completion: it never throws, and keeps reading
// past whatever is invalid.

test("readNext: skips unknown options", () => {
  const a: Option = { name: "-a" };
  const spec: Spec = { name: "test", args: [{ name: "first" }, { name: "second" }], options: [a] };
  const input = ["--nope", "--nope=value", "-zaz", "arg"];
  expect(readToken(spec, [], "--nope")).toEqual({ kind: "unknown" });
  expect(readToken(spec, input.slice(0, 2), "-zaz")).toEqual({
    kind: "options",
    options: [a],
    attached: null,
  });
  expect(readNext(spec, input, "").arg).toBe((spec.args as Arg[])[1]);
});

test("readNext: keeps counting arguments past the maximum", () => {
  const next = readNext({ name: "test", args: { name: "only" } }, ["one", "two", "--", "three"], "");
  expect(next.arg).toBeUndefined();
  expect(next.optionsAllowed).toBe(false);
});

test("readNext: a value attached to an option without args isn't an argument", () => {
  const flag: Option = { name: "--flag" };
  const spec: Spec = { name: "test", args: { name: "a" }, options: [flag] };
  expect(readToken(spec, [], "--flag=value")).toEqual({ kind: "options", options: [flag], attached: null });
  expect(readNext(spec, ["--flag=value"], "").arg).toBe(spec.args);
});

test("readNext: keeps reading past missing and repeated option values", () => {
  const out: Option = { name: "--out", args: {} };
  const verbose: Option = { name: "-v", isRepeatable: 1 };
  const spec: Spec = { name: "test", options: [out, verbose] };
  expect(readToken(spec, ["-v"], "-v")).toEqual({ kind: "options", options: [verbose], attached: null });
  const next = readNext(spec, ["-v", "-v", "--out"], "");
  // -v can be used once, so the second use doesn't make it usable again.
  expect(next.options.map((usable) => usable.option)).toEqual([out]);
  expect(next.value).toEqual({ option: out, arg: out.args, required: true });
});

test("readNext: doesn't require options or arguments", () => {
  const spec: Spec = { name: "test", args: {}, options: [{ name: "--req", isRequired: true }] };
  expect(() => readNext(spec, [], "")).not.toThrow();
  expect(() => parse([], spec)).toThrow();
});

test("readNext: an option with room for values can take the next token", () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect(readNext(spec, ["--tags"], "").value).toEqual({ option, arg: option.args, required: true });
  expect(readNext(spec, ["--tags", "a", "b"], "").value).toEqual({
    option,
    arg: option.args,
    required: false,
  });
  // An attached value is the option's only value.
  expect(readNext(spec, ["--tags=a"], "").value).toBeNull();
});

test("readNext: '--' closes an open option", () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect(readNext(spec, ["--tags", "a", "--"], "").value).toBeNull();
  expect(readNext(spec, ["--tags", "--", "b"], "").value).toBeNull();
});

test("readNext: an option that requires a separator never takes the next token", () => {
  const option: Option = { name: "--option", args: {}, requiresSeparator: true };
  const spec: Spec = { name: "test", options: [option] };
  expect(readNext(spec, ["--option"], "").value).toBeNull();
});

test("readNext: reports the directives in effect for the final command", () => {
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
  expect(readNext(spec, [], "").directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: true,
    subcommandsMatchUniquePrefix: true,
  });
  expect(readNext(spec, ["sub"], "").directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: true,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: true,
  });
});

test("readNext: skips unknown characters in a chain and keeps the rest", () => {
  const a: Option = { name: "-a" };
  const b: Option = { name: "-b" };
  expect(readToken({ name: "test", options: [a, b] }, [], "-axb")).toEqual({
    kind: "options",
    options: [a, b],
    attached: null,
  });
});

test("readToken: says what each kind of token is read as", () => {
  const out: Option = { name: "--out", args: {} };
  const sub: Subcommand = { name: "sub" };
  const spec: Spec = { name: "test", args: { isVariadic: true }, options: [out], subcommands: [sub] };
  expect(readToken(spec, [], "--")).toEqual({ kind: "separator" });
  expect(readToken(spec, [], "sub")).toEqual({ kind: "subcommand", command: sub });
  expect(readToken(spec, [], "--out=a")).toEqual({
    kind: "options",
    options: [out],
    attached: { option: out, start: 6 },
  });
  expect(readToken(spec, ["--out"], "a")).toEqual({ kind: "value", option: out });
  expect(readToken(spec, ["--out"], "--nope")).toEqual({ kind: "value", option: out });
  expect(readToken(spec, [], "a")).toEqual({ kind: "argument" });
  expect(readToken(spec, ["--"], "--out")).toEqual({ kind: "argument" });
  expect(readToken(spec, [], "--nope")).toEqual({ kind: "unknown" });
});

test("readNext: lists the options the next token can use, with the names that read as each", () => {
  const all: Option = { name: ["-a", "--all"], isPersistent: true };
  const shadow: Option = { name: "--all", hidden: true };
  const file: Option = { name: "--file", args: {}, requiresSeparator: true };
  const lone: Option = { name: ["--lone", "build"] };
  const sub: Subcommand = { name: "sub", options: [shadow, file, lone], subcommands: [{ name: "build" }] };
  const spec: Spec = { name: "test", options: [all], subcommands: [sub] };
  expect(readNext(spec, ["sub", "--lone"], "").options).toEqual([
    { option: shadow, forms: [{ name: "--all", join: null }], used: false },
    { option: file, forms: [{ name: "--file", join: "=" }], used: false },
    // A subcommand matches "build", so only "--lone" reads as the option.
    { option: lone, forms: [{ name: "--lone", join: null }], used: true },
    // --all refers to the hidden option here, so only -a is left.
    { option: all, forms: [{ name: "-a", join: null }], used: false },
  ]);
  expect(readNext(spec, ["--"], "").options).toEqual([]);
});

test("readHelpNames: reads the names after help the way the parser reads a command line", () => {
  const status: Subcommand = { name: "status", isPersistent: true };
  const add: Subcommand = { name: "add" };
  const remote: Subcommand = { name: "remote", subcommands: [add] };
  const open: Subcommand = { name: "open", args: { name: "file" } };
  const leaf: Subcommand = { name: "leaf" };
  const help: Subcommand = { name: "help", args: { isVariadic: true, isOptional: true }, isPersistent: true };
  const spec: Spec = { name: "test", subcommands: [status, remote, open, leaf, help] };
  const at = [spec, help] as const;

  // An inherited subcommand leads on, as it does in `test leaf status`.
  expect(readHelpNames(at, ["leaf", "status"])).toMatchObject({ path: [spec, leaf, status], error: null });
  expect(readHelpNames(at, ["leaf"]).subcommands).toEqual([{ command: status, names: ["status"] }]);

  // A name where the command takes arguments, or has no subcommands, ends the names.
  expect(readHelpNames(at, ["open", "a", "add"])).toEqual({
    path: [spec, open],
    error: null,
    subcommands: [],
  });
  expect(readHelpNames(at, ["leaf", "x"])).toEqual({ path: [spec, leaf], error: null, subcommands: [] });

  // Any other name is an unknown command, reported at the command reached.
  const unknown = readHelpNames(at, ["remote", "ad"]);
  expect(unknown.path).toEqual([spec, remote]);
  expect(unknown.error).toMatchObject({ message: "Unknown command 'ad'", context: { path: [spec, remote] } });

  // No name is an option.
  expect(readHelpNames(at, ["--"]).error).toMatchObject({ message: "Unknown command '--'" });

  // An inherited copy of help ends the names, and isn't offered as a name.
  expect(readHelpNames(at, ["remote", "help", "add"])).toEqual({
    path: [spec, remote],
    error: null,
    subcommands: [],
  });
  expect(readHelpNames(at, ["remote"]).subcommands).toEqual([
    { command: add, names: ["add"] },
    { command: status, names: ["status"] },
  ]);
  // Where help is a command's own subcommand, its name leads to help.
  expect(readHelpNames(at, ["help"]).path).toEqual([spec, help]);
});
