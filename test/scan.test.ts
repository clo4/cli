import { expect, test } from "vitest";

import { parse, readNames, readNext } from "../src/parse.js";
import type { Arg, Option, Spec, Subcommand } from "../src/types.js";
import { map, readToken } from "./helpers.js";

// What each problem the parser finds says.
const unknownOption = /looks like a flag, but is unknown/;
const takesNoArguments = /doesn't take arguments/;

// How each input token is classified, checked through the result of `parse`.

test("scan: empty", async () => {
  expect((await parse([], { name: "test" })).args).toEqual([]);
});

test("scan: args", async () => {
  expect((await parse(["one", "two"], { name: "test", args: { isVariadic: true } })).args).toEqual([
    "one",
    "two",
  ]);
});

test("scan: arg separator", async () => {
  const result = await parse(["one", "--", "two"], { name: "test", args: { isVariadic: true } });
  expect(result.args).toEqual(["one", "two"]);
  expect(result.argSeparatorIndex).toBe(1);
});

test("scan: known option", async () => {
  const spec: Spec = { name: "test", options: [{ name: "--option" }] };
  expect((await parse(["--option"], spec)).options.options).toEqual(map({ "--option": [] }));
});

test("scan: known option with inline arg", async () => {
  const spec: Spec = { name: "test", options: [{ name: "--option", args: {} }] };
  expect((await parse(["--option=abc"], spec)).options.options).toEqual(map({ "--option": ["abc"] }));
});

test("scan: an inline arg for an option without args is rejected", async () => {
  const spec: Spec = { name: "test", options: [{ name: "--option" }] };
  await expect(parse(["--option=abc"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(takesNoArguments),
  });
});

test("scan: unknown option", async () => {
  await expect(parse(["--option"], { name: "test" })).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
  await expect(parse(["--option=abc"], { name: "test" })).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
});

test("scan: posix-noncompliant options with unknown option", async () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
  };
  expect((await parse(["arg", "--option"], spec)).args).toEqual(["arg", "--option"]);
});

test("scan: posix-noncompliant options with known option", async () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "option", args: { isOptional: true } }],
  };
  const result = await parse(["arg", "option", "option=value"], spec);
  expect(result.args).toEqual(["arg"]);
  expect(result.options.options).toEqual(map({ option: ["value"] }));
});

test("scan: option arg separators", async () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: {
      optionArgSeparators: ["=", ":"],
      flagsArePosixNoncompliant: true,
    },
    options: [{ name: "option", args: { isOptional: true } }],
  };
  const result = await parse(["arg", "option", "option:value"], spec);
  expect(result.args).toEqual(["arg"]);
  expect(result.options.options).toEqual(map({ option: ["value"] }));
});

test("scan: anonymous options", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-", args: {} }, { name: "+", args: {} }, { name: "-x" }, { name: "-y" }],
  };
  expect((await parse(["-123", "+abc", "-xy"], spec)).options.options).toEqual(
    map({ "-": ["123"], "+": ["abc"], "-x": [], "-y": [] }),
  );
});

test("scan: chained options", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-x" }, { name: "-y" }, { name: "-z" }, { name: "+x" }, { name: "+y" }, { name: "+z" }],
  };
  expect([...(await parse(["-xyz", "+xyz"], spec)).options.options.keys()]).toEqual([
    "-x",
    "-y",
    "-z",
    "+x",
    "+y",
    "+z",
  ]);
});

test("scan: subcommand", async () => {
  const cmd: Subcommand = { name: "cmd", options: [{ name: "--option" }] };
  const spec: Spec = { name: "test", subcommands: [cmd] };
  const result = await parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, cmd]);
  expect(result.options.options).toEqual(map({ "--option": [] }));
});

test("scan: persistent options", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  const result = await parse(["cmd", "--option"], spec);
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
  expect(result.options.options).toEqual(map({ "--option": [] }));
});

test("scan: optionsMustPrecedeArguments", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--option", isPersistent: true }],
    subcommands: [{ name: "cmd", args: { isVariadic: true } }],
  };
  const result = await parse(["cmd", "--option", "arg", "--option"], spec);
  expect(result.options.options).toEqual(map({ "--option": [] }));
  expect(result.args).toEqual(["arg", "--option"]);
});

test("scan: subcommandsMatchUniquePrefix", async () => {
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
  expect((await parse(["long-name"], spec)).path[1]).toBe(commands[0]);
  expect((await parse(["abc"], spec)).path[1]).toBe(commands[3]);
  expect((await parse(["abc-"], spec)).path[1]).toBe(commands[2]);
  // An ambiguous prefix is an argument.
  expect((await parse(["long-"], spec)).args).toEqual(["long-"]);
  expect((await parse(["long-n"], spec)).path[1]).toBe(commands[0]);
  expect((await parse(["n"], spec)).path[1]).toBe(commands[0]);
});

test("scan: a separate option value belongs to the option", async () => {
  const spec: Spec = { name: "test", args: {}, options: [{ name: "--option", args: {} }] };
  const result = await parse(["--option", "abc", "def"], spec);
  expect(result.options.options).toEqual(map({ "--option": ["abc"] }));
  expect(result.args).toEqual(["def"]);
});

// readNext reads leniently for completion: it never throws, and keeps reading
// past whatever is invalid.

test("readNext: skips unknown options", async () => {
  const a: Option = { name: "-a" };
  const spec: Spec = { name: "test", args: [{ name: "first" }, { name: "second" }], options: [a] };
  const input = ["--nope", "--nope=value", "-zaz", "arg"];
  expect(await readToken(spec, [], "--nope")).toEqual({ kind: "unknown" });
  expect(await readToken(spec, input.slice(0, 2), "-zaz")).toEqual({
    kind: "options",
    options: [a],
    attached: null,
  });
  expect((await readNext(spec, input, "")).arg).toBe((spec.args as Arg[])[1]);
});

test("readNext: keeps counting arguments past the maximum", async () => {
  const next = await readNext({ name: "test", args: { name: "only" } }, ["one", "two", "--", "three"], "");
  expect(next.arg).toBeUndefined();
  expect(next.optionsAllowed).toBe(false);
});

test("readNext: a value attached to an option without args isn't an argument", async () => {
  const flag: Option = { name: "--flag" };
  const spec: Spec = { name: "test", args: { name: "a" }, options: [flag] };
  expect(await readToken(spec, [], "--flag=value")).toEqual({
    kind: "options",
    options: [flag],
    attached: null,
  });
  expect((await readNext(spec, ["--flag=value"], "")).arg).toBe(spec.args);
});

test("readNext: keeps reading past missing and repeated option values", async () => {
  const out: Option = { name: "--out", args: {} };
  const verbose: Option = { name: "-v", isRepeatable: 1 };
  const spec: Spec = { name: "test", options: [out, verbose] };
  expect(await readToken(spec, ["-v"], "-v")).toEqual({
    kind: "options",
    options: [verbose],
    attached: null,
  });
  const next = await readNext(spec, ["-v", "-v", "--out"], "");
  // -v can be used once, so the second use doesn't make it usable again.
  expect(next.options().map((usable) => usable.option)).toEqual([out]);
  expect(next.value).toEqual({ option: out, arg: out.args, required: true });
});

test("readNext: doesn't require options or arguments", async () => {
  const spec: Spec = { name: "test", args: {}, options: [{ name: "--req", isRequired: true }] };
  await expect(readNext(spec, [], "")).resolves.toBeDefined();
  await expect(parse([], spec)).rejects.toThrow();
});

test("readNext: an option with room for values can take the next token", async () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect((await readNext(spec, ["--tags"], "")).value).toEqual({ option, arg: option.args, required: true });
  expect((await readNext(spec, ["--tags", "a", "b"], "")).value).toEqual({
    option,
    arg: option.args,
    required: false,
  });
  // An attached value is the option's only value.
  expect((await readNext(spec, ["--tags=a"], "")).value).toBeNull();
});

test("readNext: '--' closes an open option", async () => {
  const option: Option = { name: "--tags", args: { isVariadic: true } };
  const spec: Spec = { name: "test", options: [option] };
  expect((await readNext(spec, ["--tags", "a", "--"], "")).value).toBeNull();
  expect((await readNext(spec, ["--tags", "--", "b"], "")).value).toBeNull();
});

test("readNext: an option that requires a separator never takes the next token", async () => {
  const option: Option = { name: "--option", args: {}, requiresSeparator: true };
  const spec: Spec = { name: "test", options: [option] };
  expect((await readNext(spec, ["--option"], "")).value).toBeNull();
});

test("readNext: reports the directives in effect for the final command", async () => {
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
  expect((await readNext(spec, [], "")).directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: true,
    subcommandsMatchUniquePrefix: true,
  });
  expect((await readNext(spec, ["sub"], "")).directives).toEqual({
    optionArgSeparators: [":", "="],
    flagsArePosixNoncompliant: true,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: true,
  });
});

test("readNext: skips unknown characters in a chain and keeps the rest", async () => {
  const a: Option = { name: "-a" };
  const b: Option = { name: "-b" };
  expect(await readToken({ name: "test", options: [a, b] }, [], "-axb")).toEqual({
    kind: "options",
    options: [a, b],
    attached: null,
  });
});

test("a token reading: says what each kind of token is read as", async () => {
  const dir: Arg = { name: "dir" };
  const out: Option = { name: "--out", args: dir };
  const sub: Subcommand = { name: "sub" };
  const file: Arg = { name: "file", isVariadic: true };
  const spec: Spec = { name: "test", args: file, options: [out], subcommands: [sub] };
  expect(await readToken(spec, [], "--")).toEqual({ kind: "separator" });
  expect(await readToken(spec, [], "sub")).toEqual({ kind: "subcommand", command: sub });
  expect(await readToken(spec, [], "--out=a")).toEqual({
    kind: "options",
    options: [out],
    attached: { option: out, arg: dir, start: 6 },
  });
  expect(await readToken(spec, ["--out"], "a")).toEqual({ kind: "value", option: out, arg: dir });
  expect(await readToken(spec, ["--out"], "--nope")).toEqual({ kind: "value", option: out, arg: dir });
  expect(await readToken(spec, [], "a")).toEqual({ kind: "argument", arg: file });
  expect(await readToken(spec, ["--"], "--out")).toEqual({ kind: "argument", arg: file });
  expect(await readToken(spec, [], "--nope")).toEqual({ kind: "unknown" });
});

test("a token reading: an argument past the command's last is for none", async () => {
  const spec: Spec = { name: "test", args: { name: "only" } };
  expect(await readToken(spec, ["one"], "two")).toEqual({ kind: "argument", arg: undefined });
});

test("readNext: lists the options the next token can use, with the names that read as each", async () => {
  const all: Option = { name: ["-a", "--all"], isPersistent: true };
  const shadow: Option = { name: "--all", hidden: true };
  const file: Option = { name: "--file", args: {}, requiresSeparator: true };
  const lone: Option = { name: ["--lone", "build"] };
  const sub: Subcommand = { name: "sub", options: [shadow, file, lone], subcommands: [{ name: "build" }] };
  const spec: Spec = { name: "test", options: [all], subcommands: [sub] };
  expect((await readNext(spec, ["sub", "--lone"], "")).options()).toEqual([
    { option: shadow, forms: [{ name: "--all", join: null }], used: false },
    { option: file, forms: [{ name: "--file", join: "=" }], used: false },
    // A subcommand matches "build", so only "--lone" reads as the option.
    { option: lone, forms: [{ name: "--lone", join: null }], used: true },
    // --all refers to the hidden option here, so only -a is left.
    { option: all, forms: [{ name: "-a", join: null }], used: false },
  ]);
  expect((await readNext(spec, ["--"], "")).options()).toEqual([]);
});

test("readNames: reads names of subcommands the way the parser reads a command line", async () => {
  const status: Subcommand = { name: "status", isPersistent: true };
  const add: Subcommand = { name: "add" };
  const remote: Subcommand = { name: "remote", subcommands: [add] };
  const open: Subcommand = { name: "open", args: { name: "file" } };
  const leaf: Subcommand = { name: "leaf" };
  const spec: Spec = { name: "test", subcommands: [status, remote, open, leaf] };
  const at = [spec] as const;

  // An inherited subcommand leads on, as it does in `test leaf status`.
  expect(await readNames(at, ["leaf", "status"])).toMatchObject({
    path: [spec, leaf, status],
    error: null,
  });
  expect((await readNames(at, ["leaf"])).subcommands).toEqual([{ command: status, names: ["status"] }]);

  // A name where the command takes arguments, or has no subcommands, ends the names.
  expect(await readNames(at, ["open", "a", "add"])).toEqual({
    path: [spec, open],
    error: null,
    subcommands: [],
  });
  expect(await readNames(at, ["leaf", "x"])).toEqual({
    path: [spec, leaf],
    error: null,
    subcommands: [],
  });

  // Any other name is an unknown command, reported at the command reached.
  const unknown = await readNames(at, ["remote", "ad"]);
  expect(unknown.path).toEqual([spec, remote]);
  expect(unknown.error).toMatchObject({ message: "Unknown command 'ad'", context: { path: [spec, remote] } });

  // No name is an option.
  expect((await readNames(at, ["--"])).error).toMatchObject({ message: "Unknown command '--'" });

  // Reading starts after the last command on the path.
  expect((await readNames([spec, remote], ["add"])).path).toEqual([spec, remote, add]);
});
