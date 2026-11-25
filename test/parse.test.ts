import { expect, test } from "vitest";

import { parse } from "../src/parse.js";
import type { Action, Option, OptionArgs, Spec, Subcommand } from "../src/types.js";
import { map } from "./helpers.js";

import { ParseError } from "../src/errors.js";

// What each problem the parser finds says.
const unknownOption = /looks like a flag, but is unknown/;
const takesNoArguments = /doesn't take arguments/;
const tooFewArguments = /^Expected /;
const tooFewOptionArguments = /^Option \S+ needs /;
const tooManyArguments = /^Too many arguments/;
const missingOption = /is required, but wasn't found/;

test("parse: no args and no values executes action", async () => {
  const result = await parse([], { name: "test" });
  expect(result.args).toEqual([]);
});

test("parse: one arg with one value succeeds", async () => {
  const result = await parse(["value"], { name: "test", args: {} });
  expect(result.args).toEqual(["value"]);
});

test("parse: no args with one value fails", async () => {
  await expect(parse(["value"], { name: "test" })).rejects.toThrow();
});

test("parse: one arg with two values fails", async () => {
  await expect(parse(["value1", "value2"], { name: "test", args: {} })).rejects.toThrow();
});

test("parse: single arg with no values fails", async () => {
  await expect(parse([], { name: "test", args: {} })).rejects.toThrow();
});

test("parse: two args arg with one value fails", async () => {
  const spec: Spec = {
    name: "test",
    args: [{ name: "arg1" }, { name: "arg2" }],
  };
  await expect(parse(["value"], spec)).rejects.toThrow();
});

test("parse: two args with two values succeeds", async () => {
  const result = await parse(["value1", "value2"], {
    name: "test",
    args: [{}, {}],
  });
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: variadic arg succeeds with one value", async () => {
  const result = await parse(["value1", "value2", "value3"], {
    name: "test",
    args: { isVariadic: true },
  });
  expect(result.args).toEqual(["value1", "value2", "value3"]);
});

test("parse: variadic arg fails with zero values", async () => {
  await expect(parse([], { name: "test", args: { isVariadic: true } })).rejects.toThrow();
});

test("parse: variadic+optional arg succeeds with zero values", async () => {
  const result = await parse([], {
    name: "test",
    args: { isVariadic: true, isOptional: true },
  });
  expect(result.args).toEqual([]);
});

test("parse: options without args are [] when present", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: ["--present", "--alias"] },
      { name: "--missing" },
      { name: ["--another", "--another-alias"] },
    ],
  };
  const result = await parse(["--present"], spec);
  expect(result.options.options).toEqual(
    map({
      "--present": [],
      "--alias": [],
    }),
  );
});

test("parse: options and args can be interspersed", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option" }],
    args: [{}, {}],
  };
  const result = await parse(["value1", "--option", "value2"], spec);
  expect(result.options.options).toEqual(map({ "--option": [] }));
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: options can have values as the next argument", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: [{ name: "arg1" }, { name: "arg2" }],
  };
  const result = await parse(["value1", "--arg", "optionargval", "value2"], spec);
  expect(result.options.options).toEqual(map({ "--arg": ["optionargval"] }));
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: options can take multiple arguments", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      {
        name: "--arg",
        args: [{ name: "optionarg1" }, { name: "optionarg2" }],
      },
    ],
  };
  const result = await parse(["--arg", "value1", "value2"], spec);
  expect(result.options.options).toEqual(map({ "--arg": ["value1", "value2"] }));
});

test("parse: action on spec gets returned", async () => {
  const action: Action = () => {};
  const result = await parse([], { name: "test", action });
  expect(result.action).toBe(action);
});

test("parse: the deepest command's action is picked", async () => {
  const actions: Action[] = [() => {}, () => {}, () => {}];
  const spec: Spec = {
    name: "test",
    action: actions[0],
    subcommands: [{ name: "1", action: actions[1], subcommands: [{ name: "2", action: actions[2] }] }],
  };
  expect((await parse([], spec)).action).toBe(actions[0]);
  expect((await parse(["1"], spec)).action).toBe(actions[1]);
  expect((await parse(["1", "2"], spec)).action).toBe(actions[2]);
});

test("parse: a command without an action has no action, never an ancestor's action", async () => {
  const spec: Spec = {
    name: "test",
    action: () => {},
    subcommands: [{ name: "1", subcommands: [{ name: "2" }] }],
  };
  expect((await parse(["1"], spec)).action).toBeUndefined();
  expect((await parse(["1", "2"], spec)).action).toBeUndefined();
  expect((await parse([], { name: "test" })).action).toBeUndefined();
});

test("parse: a command without an action still checks its arguments and options", async () => {
  const spec: Spec = {
    name: "test",
    args: {},
    options: [{ name: "--token", isRequired: true }],
  };
  await expect(parse(["--token"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(tooFewArguments),
  });
  await expect(parse(["a"], spec)).rejects.toMatchObject({ message: expect.stringMatching(missingOption) });
  expect((await parse(["a", "--token"], spec)).action).toBeUndefined();
  // Only a command that requires a subcommand skips them, when none is named.
  expect((await parse([], { ...spec, args: undefined, requiresSubcommand: true })).action).toBeUndefined();
});

test("parse: action on option is preferred to spec action", async () => {
  const specAction: Action = () => {};
  const optionAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    action: specAction,
    options: [{ name: "--option", action: optionAction }],
  };
  const result = await parse(["--option"], spec);
  expect(result.action).toBe(optionAction);
});

test("parse: final option action is preferred", async () => {
  const specAction: Action = () => {};
  const optionAction: Action = () => {};
  const finalAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    action: specAction,
    options: [
      { name: "--option", action: optionAction },
      { name: "--final", action: finalAction },
    ],
  };
  const result = await parse(["--option", "--final"], spec);
  expect(result.action).toBe(finalAction);
});

test("parse: the final option action is picked from any command on the path", async () => {
  // run-fig preferred the first option action. @clo4/cli intentionally uses
  // the final parsed option action so later helpers can override earlier ones.
  const alpha: Action = () => {};
  const spec: Spec = {
    name: "test",
    action: () => {},
    options: [
      { name: "--alpha", isPersistent: true, action: alpha },
      { name: "--beta", isPersistent: true, action: () => {} },
    ],
    subcommands: [
      {
        name: "1",
        action: () => {},
        subcommands: [{ name: "2", action: () => {}, options: [{ name: "--test", action: () => {} }] }],
      },
    ],
  };
  expect((await parse(["1", "--beta", "2", "--test", "--alpha"], spec)).action).toBe(alpha);
});

test("parse: option actions allow incorrect arguments", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option", action: () => {} }],
    args: {},
  };
  await parse(["--option"], spec);
});

test("parse: option arguments can be separated with an equals", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
  };
  const result = await parse(["--arg=value", "test"], spec);
  expect(result.options.options).toEqual(map({ "--arg": ["value"] }));
  expect(result.args).toEqual(["test"]);
});

test("parse: option arg separator cannot be used with more than 1 arg", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--plain", args: {} },
      { name: "--empty", args: {} },
      { name: "--optional", args: [{}, { isOptional: true }] },
      { name: "--variadic", args: { isVariadic: true } },
      { name: "--fail", args: [{}, {}] },
    ],
  };
  const result = await parse(["--plain=value", "--empty=", "--optional=value", "--variadic=value"], spec);
  expect(result.options.options).toEqual(
    map({
      "--plain": ["value"],
      "--empty": [""],
      "--optional": ["value"],
      "--variadic": ["value"],
    }),
  );
  await expect(parse(["--fail=value"], spec)).rejects.toThrow();
});

test("parse: unknown options are rejected", async () => {
  const spec: Spec = { name: "test", args: {} };
  await expect(parse(["-a"], spec)).rejects.toThrow();
  await expect(parse(["-test"], spec)).rejects.toThrow();
  await expect(parse(["--test"], spec)).rejects.toThrow();
});

test("parse: '-' is a valid option name", async () => {
  const result = await parse(["-123"], {
    name: "test",
    options: [{ name: "-", args: {} }],
  });
  expect(result.options.options).toEqual(map({ "-": ["123"] }));
});

test("parse: '+' is a valid option name", async () => {
  const result = await parse(["+123"], {
    name: "test",
    options: [{ name: "+", args: {} }],
  });
  expect(result.options.options).toEqual(map({ "+": ["123"] }));
});

test("parse: '-' option is used if the following character isn't a option", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "-", args: {} },
      { name: "-a", args: {} },
    ],
  };
  expect((await parse(["-1a"], spec)).options.options).toEqual(map({ "-": ["1a"] }));
  expect((await parse(["-a1"], spec)).options.options).toEqual(map({ "-a": ["1"] }));
});

test("parse: '+' option is used if the following character isn't a option", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "+a", args: {} },
    ],
  };
  expect((await parse(["+1a"], spec)).options.options).toEqual(map({ "+": ["1a"] }));
  expect((await parse(["+a1"], spec)).options.options).toEqual(map({ "+a": ["1"] }));
});

test("parse: '+' and '-' are treated as args if they aren't valid options", async () => {
  const result = await parse(["-", "+"], { name: "test", args: [{}, {}] });
  expect(result.args).toEqual(["-", "+"]);
});

test("parse: '+' and '-' are treated as args if there is no argument", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "-", args: {} },
    ],
    args: [{}, {}],
  };
  const result = await parse(["-", "+"], spec);
  expect(result.args).toEqual(["-", "+"]);
  expect(result.options.options).toEqual(new Map());
});

test("parse: options starting with '+ can be chained", async () => {
  const result = await parse(["+abc"], {
    name: "test",
    options: [{ name: "+a" }, { name: "+b" }, { name: "+c" }],
  });
  expect(result.options.options).toEqual(map({ "+a": [], "+b": [], "+c": [] }));
});

test("parse: options starting with a single dash can be chained", async () => {
  const result = await parse(["-abc"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b" }, { name: "-c" }],
  });
  expect(result.options.options).toEqual(map({ "-a": [], "-b": [], "-c": [] }));
});

test("parse: chained options can have arguments in the same value with no separator", async () => {
  const result = await parse(["-abc"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: chained options ignore separators", async () => {
  const result = await parse(["-ab=c"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: chained options can have arguments in the next token", async () => {
  const result = await parse(["-ab", "c"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: tokens starting with '--' that don't match a option is an error", async () => {
  await expect(parse(["--fail"], { name: "test", args: {} })).rejects.toThrow();
});

test("parse: POSIX noncompliance disables throwing on unknown options", async () => {
  const spec: Spec = {
    name: "test",
    args: {},
    parserDirectives: { flagsArePosixNoncompliant: true },
  };
  expect((await parse(["--succeed"], spec)).args).toEqual(["--succeed"]);
});

test("parse: POSIX-noncompliant options work as expected", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [
      { name: ["present", "alias"] },
      { name: "missing" },
      { name: ["another", "another-alias"], args: {} },
    ],
  };
  const result = await parse(["present", "another=value"], spec);
  expect(result.options.options).toEqual(
    map({
      present: [],
      alias: [],
      another: ["value"],
      "another-alias": ["value"],
    }),
  );
});

test("parse: option arguments can have another separator", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
  };
  const result = await parse(["--arg:value", "test"], spec);
  expect(result.options.options).toEqual(map({ "--arg": ["value"] }));
  expect(result.args).toEqual(["test"]);
});

test("parse: subcommands are optional", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
    subcommands: [{ name: "subcommand" }],
  };
  const result = await parse(["test"], spec);
  expect(result.path).toEqual([spec]);
  expect(result.options.options).toEqual(new Map());
  expect(result.args).toEqual(["test"]);
});

test("parse: path is correct", async () => {
  const two: Subcommand = { name: "two" };
  const one: Subcommand = { name: "one", subcommands: [two] };
  const spec: Spec = { name: "test", subcommands: [one] };
  expect((await parse(["one", "two"], spec)).path).toEqual([spec, one, two]);
});

test("parse: subcommands are preferred over arguments", async () => {
  const subcommand: Subcommand = { name: "subcommand" };
  const spec: Spec = {
    name: "test",
    subcommands: [subcommand],
    args: {},
  };
  const result = await parse(["subcommand"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.args).toEqual([]);
});

test("parse: persistent options are carried through into subcommands", async () => {
  const subcommand: Subcommand = {
    name: "subcommand",
    options: [{ name: "--sub" }],
  };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--top", isPersistent: true }],
    subcommands: [subcommand],
  };
  const result = await parse(["subcommand", "--top"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.args).toEqual([]);
});

test("parse: persistent options can be used before a subcommand", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--persistent", isPersistent: true }],
    subcommands: [{ name: "subcommand" }],
  };
  expect((await parse(["--persistent", "subcommand"], spec)).options.options).toEqual(
    map({ "--persistent": [] }),
  );
});

test("parse: non-persistent options can be used before a subcommand", async () => {
  const subcommand: Subcommand = { name: "subcommand" };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--not-persistent" }],
    subcommands: [subcommand],
  };
  const result = await parse(["--not-persistent", "subcommand"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.options.options).toEqual(map({ "--not-persistent": [] }));
  await expect(parse(["subcommand", "--not-persistent"], spec)).rejects.toThrow();
});

test("parse: a parent's required option can be supplied before the subcommand", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--req", isRequired: true }],
    subcommands: [{ name: "sub" }],
  };
  expect((await parse(["--req", "sub"], spec)).path).toHaveLength(2);
  await expect(parse(["sub", "--req"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
});

test("parse: an option's value doesn't stop subcommand matching", async () => {
  const status: Subcommand = { name: "status" };
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: { name: "path" } }],
    subcommands: [status],
  };
  for (const input of [
    ["-C", "/repo", "status"],
    ["-C/repo", "status"],
  ]) {
    const result = await parse(input, spec);
    expect(result.path).toEqual([spec, status]);
    expect(result.options.options).toEqual(map({ "-C": ["/repo"] }));
  }
  await expect(parse(["status", "-C", "/repo"], spec)).rejects.toThrow();
});

test("parse: a persistent option's value doesn't stop subcommand matching", async () => {
  const evalCommand: Subcommand = { name: "eval" };
  const spec: Spec = {
    name: "nix",
    args: { isOptional: true, isVariadic: true },
    options: [{ name: "--features", isPersistent: true, args: {} }],
    subcommands: [evalCommand],
  };
  for (const input of [
    ["--features", "a", "eval"],
    ["--features=a", "eval"],
    ["eval", "--features", "a"],
  ]) {
    const result = await parse(input, spec);
    expect(result.path).toEqual([spec, evalCommand]);
    expect(result.args).toEqual([]);
    expect(result.options.options).toEqual(map({ "--features": ["a"] }));
  }
});

test("parse: a required option value can match a subcommand name", async () => {
  const status: Subcommand = { name: "status" };
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: {} }],
    subcommands: [status],
  };
  const result = await parse(["-C", "status", "status"], spec);
  expect(result.path).toEqual([spec, status]);
  expect(result.options.options).toEqual(map({ "-C": ["status"] }));
});

test("parse: a subcommand ends an option whose optional value is missing", async () => {
  const sub: Subcommand = { name: "sub" };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sub],
  };
  expect((await parse(["--color", "sub"], spec)).path).toEqual([spec, sub]);
  expect((await parse(["--color", "auto", "sub"], spec)).options.options).toEqual(
    map({ "--color": ["auto"] }),
  );
});

test("parse: a subcommand closes the option before it", async () => {
  const sub: Subcommand = { name: "sub", args: { isOptional: true } };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sub],
  };
  const result = await parse(["--color", "sub", "value"], spec);
  expect(result.path).toEqual([spec, sub]);
  expect(result.args).toEqual(["value"]);
  expect(result.options.options).toEqual(map({ "--color": [] }));
});

test("parse: an optional value only gives way to an exact subcommand name", async () => {
  const sync: Subcommand = { name: "always-sync" };
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sync, { name: "build" }],
  };
  const prefix = await parse(["--color", "a"], spec);
  expect(prefix.path).toEqual([spec]);
  expect(prefix.options.options).toEqual(map({ "--color": ["a"] }));
  const empty = await parse(["--color", ""], { ...spec, subcommands: [{ name: "build" }] });
  expect(empty.path).toHaveLength(1);
  expect(empty.options.options).toEqual(map({ "--color": [""] }));
  expect((await parse(["--color", "always-sync"], spec)).path).toEqual([spec, sync]);
  expect((await parse(["al"], spec)).path).toEqual([spec, sync]);
  expect((await parse(["--color", "auto", "al"], spec)).path).toEqual([spec, sync]);
});

test("parse: distinct long names keep both values when short names clash", async () => {
  const blame: Subcommand = {
    name: "blame",
    args: { isOptional: true },
    options: [{ name: ["-C", "--moved-or-copied"] }],
  };
  const spec: Spec = {
    name: "git",
    options: [{ name: ["-C", "--cd"], args: {} }],
    subcommands: [blame],
  };
  for (const input of [
    ["-C", "/repo", "blame", "-C", "file"],
    ["--cd", "/repo", "blame", "--moved-or-copied", "file"],
  ]) {
    const result = await parse(input, spec);
    expect(result.args).toEqual(["file"]);
    expect(result.options.get("--cd")).toBe("/repo");
    expect(result.options.has("--moved-or-copied")).toBe(true);
    // At blame, -C means the local option, which takes no argument.
    expect(result.options.all("-C")).toEqual([]);
  }
});

test("parse: a repeatable option's count follows its names across commands", async () => {
  const verbose: Option = { name: ["-v", "--verbose"], isRepeatable: true };
  const count = async (spec: Spec, name: string) =>
    (await parse(["-v", "-v", "sub", "-v"], spec)).options.count(name);
  const withChild = (option: Option): Spec => ({
    name: "test",
    options: [verbose],
    subcommands: [{ name: "sub", options: [option] }],
  });
  expect(await count(withChild(verbose), "-v")).toBe(3);
  expect(await count(withChild({ ...verbose }), "-v")).toBe(3);
  const separate = withChild({ name: ["-v", "--inner"], isRepeatable: true });
  expect(await count(separate, "--verbose")).toBe(2);
  expect(await count(separate, "--inner")).toBe(1);
  // An option with some of the parent's names is a different option too.
  const subset = withChild({ name: "-v", isRepeatable: true });
  expect(await count(subset, "--verbose")).toBe(2);
  expect(await count(subset, "-v")).toBe(1);
  // A copy with its names in another order is the same option.
  expect(await count(withChild({ name: ["--verbose", "-v"], isRepeatable: true }), "-v")).toBe(3);
});

test("parse: a repeatable option's uses stay its own when another option shares a name", async () => {
  // The persistent option shares `+a` with the local one, which wins it.
  const spec: Spec = {
    name: "test",
    options: [
      { name: "+a", isRepeatable: 2 },
      { name: ["-c", "+a"], args: {}, isPersistent: true },
    ],
  };
  const result = await parse(["-c", "v", "+a", "+a"], spec);
  expect(result.options.get("-c")).toBe("v");
  expect(result.options.count("+a")).toBe(2);
  // A use of the other option between two uses doesn't drop the first.
  const twice: Spec = {
    name: "test",
    options: [
      { name: ["-x", "+x"], args: {}, isRepeatable: true },
      { name: ["-x", "-y"], args: {}, isPersistent: true },
    ],
  };
  expect((await parse(["-x1", "-y2", "+x3"], twice)).options.all("+x")).toEqual(["1", "3"]);
});

test("parse: a subcommand can reuse a parent option's name", async () => {
  const blame: Subcommand = { name: "blame", args: {}, options: [{ name: "-C" }] };
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: {} }],
    subcommands: [blame],
  };
  const result = await parse(["-C", "/repo", "blame", "-C", "file"], spec);
  expect(result.path).toEqual([spec, blame]);
  expect(result.args).toEqual(["file"]);
});

test("parse: option values don't count towards optionsMustPrecedeArguments", async () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true, isVariadic: true },
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--a", args: {} }, { name: "--b" }],
  };
  const result = await parse(["--a", "1", "--b", "x", "--b"], spec);
  expect(result.options.options).toEqual(map({ "--a": ["1"], "--b": [] }));
  expect(result.args).toEqual(["x", "--b"]);
});

test("parse: '--' token causes all tokens after it to become args", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--one" }, { name: "--two" }],
    args: [{}, {}],
    subcommands: [{ name: "subcommand", options: [{ name: "--yes" }] }],
  };
  const result1 = await parse(["--one", "--", "--two", "--"], spec);
  expect(result1.options.options).toEqual(map({ "--one": [] }));
  expect(result1.args).toEqual(["--two", "--"]);

  const result2 = await parse(["--one", "--", "subcommand", "--yes"], spec);
  expect(result2.options.options).toEqual(map({ "--one": [] }));
  expect(result2.args).toEqual(["subcommand", "--yes"]);
});

test("parse: '--' fails with too few arguments", async () => {
  const spec: Spec = { name: "command", args: [{}, { isOptional: true }] };
  await expect(parse(["--"], spec)).rejects.toThrow();
});

test("parse: '--' fails with too many arguments", async () => {
  const spec: Spec = { name: "command", args: [{}, { isOptional: true }] };
  await expect(parse(["--", "arg", "arg", "arg"], spec)).rejects.toThrow();
});

test("parse: '--' cannot be provided after all the arguments", async () => {
  await expect(parse(["arg", "--"], { name: "command", args: {} })).rejects.toThrow();
  await expect(parse(["--"], { name: "command" })).rejects.toThrow();
});

test("parse: the last use of a non-repeatable option wins", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--flag" }, { name: ["-c", "--color"], args: {} }],
  };
  expect((await parse(["--flag", "--flag"], spec)).options.options).toEqual(map({ "--flag": [] }));
  const { options } = await parse(["--color", "always", "-c", "never"], spec);
  expect([options.all("-c"), options.all("--color")]).toEqual([["never"], ["never"]]);
});

test("parse: repeatable options definitely have one item in the array", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: true }],
  };
  expect((await parse(["--rep"], spec)).options.options).toEqual(map({ "--rep": [""], "-r": [""] }));
});

test("parse: infinitely repeatable options work", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: true }],
  };
  for (const input of [["--rep", "--rep", "--rep", "--rep"], ["-rrrr"]]) {
    const { options } = await parse(input, spec);
    expect([options.count("--rep"), options.count("-r")]).toEqual([4, 4]);
  }
});

test("parse: finite repeatable options work", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: 2 }],
  };
  for (const input of [["--rep", "--rep"], ["-rr"]]) {
    const { options } = await parse(input, spec);
    expect([options.count("--rep"), options.count("-r")]).toEqual([2, 2]);
  }
  await expect(parse(["--rep", "--rep", "--rep"], spec)).rejects.toThrow();
  await expect(parse(["-rrr"], spec)).rejects.toThrow();
});

test("parse: a subcommand's copy of a repeatable option uses its own limit", async () => {
  const withLimits = (parent: number, sub: number): Spec => ({
    name: "command",
    options: [{ name: "-v", isRepeatable: parent }],
    subcommands: [{ name: "sub", options: [{ name: "-v", isRepeatable: sub }] }],
  });
  // The copies share their uses, so the last -v is the third use of both.
  const input = ["-v", "-v", "sub", "-v"];
  expect((await parse(input, withLimits(2, 3))).options.count("-v")).toBe(3);
  await expect(parse(input, withLimits(3, 2))).rejects.toThrow("Too many repetitions");
});

test("parse: requiresSeparator is true", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: {} }],
    args: { isOptional: true },
  };
  expect((await parse(["--sep=val"], spec)).options.options).toEqual(map({ "--sep": ["val"] }));
  await expect(parse(["--sep", "val"], spec)).rejects.toThrow();
});

test("parse: requiresSeparator with optional argument", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      {
        name: "--sep",
        requiresSeparator: true,
        args: { isOptional: true },
      },
    ],
    args: { isOptional: true },
  };
  const result1 = await parse(["--sep=val", "val"], spec);
  expect(result1.options.options).toEqual(map({ "--sep": ["val"] }));
  expect(result1.args).toEqual(["val"]);

  const result2 = await parse(["--sep", "val"], spec);
  expect(result2.options.options).toEqual(map({ "--sep": [] }));
  expect(result2.args).toEqual(["val"]);
});

test("parse: requiresSeparator with optional argument and following option", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: { isOptional: true } }, { name: "--example" }],
    args: { isOptional: true },
  };
  expect((await parse(["--sep", "--example"], spec)).options.options).toEqual(
    map({ "--sep": [], "--example": [] }),
  );
});

test("parse: requiresSeparator with optional argument and following subcommand", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      {
        name: "--sep",
        requiresSeparator: true,
        isPersistent: true,
        args: { isOptional: true },
      },
    ],
    subcommands: [{ name: "example" }],
    args: { isOptional: true },
  };
  const result = await parse(["--sep", "example"], spec);
  expect(result.options.options).toEqual(map({ "--sep": [] }));
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
});

test("parse: requiresSeparator with variadic argument", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: { isVariadic: true } }],
    args: { isOptional: true },
  };
  const result = await parse(["--sep=val", "val"], spec);
  expect(result.options.options).toEqual(map({ "--sep": ["val"] }));
  expect(result.args).toEqual(["val"]);
});

test("parse: requiresSeparator is the correct string", async () => {
  const spec: Spec = {
    name: "command",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--sep", requiresSeparator: ":", args: {} }],
  };
  expect((await parse(["--sep:val"], spec)).options.options).toEqual(map({ "--sep": ["val"] }));
  await expect(parse(["--sep=val"], spec)).rejects.toThrow();
});

test("parse: requiresSeparator option with following subcommand", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      {
        name: "--sep",
        requiresSeparator: true,
        isPersistent: true,
        args: {},
      },
    ],
    subcommands: [{ name: "test" }],
  };
  await expect(parse(["--sep", "test"], spec)).rejects.toThrow();
});

test("parse: exclusiveOn, unidirectional", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "-a", exclusiveOn: ["-b"] }, { name: "-b" }],
  };
  await parse(["-a"], spec);
  await parse(["-b"], spec);
  await expect(parse(["-ab"], spec)).rejects.toThrow();
  await expect(parse(["-a", "-b"], spec)).rejects.toThrow();
  await expect(parse(["-b", "-a"], spec)).rejects.toThrow();
});

test("parse: exclusiveOn, bidirectional", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "-a", exclusiveOn: ["-b"] },
      { name: "-b", exclusiveOn: ["-a"] },
    ],
  };
  await parse(["-a"], spec);
  await parse(["-b"], spec);
  await expect(parse(["-ab"], spec)).rejects.toThrow();
  await expect(parse(["-a", "-b"], spec)).rejects.toThrow();
  await expect(parse(["-b", "-a"], spec)).rejects.toThrow();
});

test("parse: dependsOn, unidirectional", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "-a", dependsOn: ["-b"] }, { name: "-b" }],
  };
  await expect(parse(["-a"], spec)).rejects.toThrow();
  await parse(["-b"], spec);
  await parse(["-ab"], spec);
  await parse(["-a", "-b"], spec);
  await parse(["-b", "-a"], spec);
});

test("parse: dependsOn, bidirectional", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "-a", dependsOn: ["-b"] },
      { name: "-b", dependsOn: ["-a"] },
    ],
  };
  await expect(parse(["-a"], spec)).rejects.toThrow();
  await expect(parse(["-b"], spec)).rejects.toThrow();
  await parse(["-ab"], spec);
  await parse(["-a", "-b"], spec);
});

test("parse: requiresSubcommand without an action has none", async () => {
  const result = await parse([], { name: "command", requiresSubcommand: true });
  expect(result.action).toBeUndefined();
});

test("parse: requiresSubcommand keeps the command's action", async () => {
  const action: Action = () => {};
  const result = await parse([], {
    name: "command",
    requiresSubcommand: true,
    action,
  });
  expect(result.action).toBe(action);
});

test("parse: Option.isRequired throws when not provided", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--angry", isRequired: true }],
  };
  await expect(parse([], spec)).rejects.toThrow();
  await parse(["--angry"], spec);
});

test("parse: Option.isRequired works when persistent", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--angry", isRequired: true, isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  await expect(parse(["cmd"], spec)).rejects.toThrow();
  await parse(["cmd", "--angry"], spec);
});

test("parse: Option.isRequired on subcommands", async () => {
  const spec: Spec = {
    name: "command",
    subcommands: [
      {
        name: "cmd",
        options: [{ name: "--angry", isRequired: true, isPersistent: true }],
      },
    ],
  };
  await parse([], spec);
  await expect(parse(["cmd"], spec)).rejects.toThrow();
  await parse(["cmd", "--angry"], spec);
});

test("parse: hidden options still parse", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--secret", hidden: true, args: {} }],
  };
  expect((await parse(["--secret", "value"], spec)).options.options).toEqual(map({ "--secret": ["value"] }));
});

test("parse: hidden subcommands still dispatch", async () => {
  const hidden: Subcommand = { name: "hidden", action: () => {} };
  const spec: Spec = { name: "command", subcommands: [hidden] };
  expect((await parse(["hidden"], spec)).path).toEqual([spec, hidden]);
});

test("parse: option with too few arguments and no separator throws", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--pair", args: [{}, {}] }],
  };
  // End of input before the second argument arrives.
  await expect(parse(["--pair", "one"], spec)).rejects.toThrow(/Option --pair needs 2 arguments/);
});

test("parse: option interrupted by another option throws too few arguments", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--need", args: {} }, { name: "--other" }],
  };
  await expect(parse(["--need", "--other"], spec)).rejects.toThrow(/Option --need needs 1 argument/);
});

test("parse: argument given to a option that takes none throws", async () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--bare" }],
  };
  // `--bare=oops` is still read as the option plus a value, and the value is
  // rejected.
  await expect(parse(["--bare=oops"], spec)).rejects.toThrow(/Option --bare doesn't take arguments/);
});

test("parse: a single input drives all three parser states", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "--normal", args: {} },
      { name: "--sep", requiresSeparator: true, args: { isOptional: true } },
    ],
    args: { isOptional: true },
  };
  // ParseArgs -> (--normal) ParseOptionArgs -> (--sep) ParseOptionArgRequireSeparator
  // -> (posarg) ParseArgs
  const result = await parse(["--normal", "nval", "--sep=sval", "posarg"], spec);
  expect(result.options.options).toEqual(map({ "--normal": ["nval"], "--sep": ["sval"] }));
  expect(result.args).toEqual(["posarg"]);
});

test("parse: dependsOn is enforced across a subcommand boundary", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "--a", isPersistent: true, dependsOn: ["--b"] },
      { name: "--b", isPersistent: true },
    ],
    subcommands: [{ name: "sub" }],
  };
  await expect(parse(["sub", "--a"], spec)).rejects.toThrow();
  await parse(["sub", "--a", "--b"], spec);
});

test("parse: exclusiveOn is enforced across a subcommand boundary", async () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "--a", isPersistent: true, exclusiveOn: ["--b"] },
      { name: "--b", isPersistent: true },
    ],
    subcommands: [{ name: "sub" }],
  };
  await parse(["sub", "--a"], spec);
  await expect(parse(["sub", "--a", "--b"], spec)).rejects.toThrow();
});

test("parse: requiresSeparator string rejects the wrong separator on a variadic option", async () => {
  const spec: Spec = {
    name: "command",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [
      {
        name: "--sep",
        requiresSeparator: ":",
        args: { isVariadic: true },
      },
    ],
  };
  expect((await parse(["--sep:val"], spec)).options.options).toEqual(map({ "--sep": ["val"] }));
  await expect(parse(["--sep=val"], spec)).rejects.toThrow(/Incorrect separator/);
});

test("parse: an unknown option after a requiresSeparator option is reported as unknown", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--tag", args: {}, requiresSeparator: true }],
  };
  await expect(parse(["--tag", "--nope"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
});

test("parse: an exact alias wins over prefix matches in prefix mode", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: ["release", "re"] }, { name: "rebuild" }],
  };
  // "re" is a prefix of both commands, but it's also an exact alias of one.
  expect((await parse(["re"], spec)).path[1]).toBe(spec.subcommands![0]);
  expect((await parse(["reb"], spec)).path[1]).toBe(spec.subcommands![1]);
  // "r" is an ambiguous prefix, so it's an argument, which this spec rejects.
  await expect(parse(["r"], spec)).rejects.toThrow();
});

test("parse: a parent's required non-persistent option isn't required by its subcommand", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--token", isRequired: true, args: {} }],
    subcommands: [{ name: "sub" }],
  };
  expect((await parse(["sub"], spec)).path).toEqual([spec, spec.subcommands![0]]);
  // The root command still requires it.
  await expect(parse([], spec)).rejects.toMatchObject({ message: expect.stringMatching(missingOption) });
});

test("parse: a subcommand's own required option is still enforced", async () => {
  const spec: Spec = {
    name: "test",
    subcommands: [{ name: "sub", options: [{ name: "--name", isRequired: true, args: {} }] }],
  };
  await expect(parse(["sub"], spec)).rejects.toMatchObject({ message: expect.stringMatching(missingOption) });
  expect((await parse(["sub", "--name", "x"], spec)).options.options).toEqual(map({ "--name": ["x"] }));
});

test("parse: a long option splits at the first separator in the token", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--define", args: {} }],
  };
  expect((await parse(["--define=k:v"], spec)).options.options).toEqual(map({ "--define": ["k:v"] }));
  expect((await parse(["--define:k=v"], spec)).options.options).toEqual(map({ "--define": ["k=v"] }));
});

test("parse: the longer of two separators that start at the same place wins", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ["=", "=="] },
    options: [{ name: "--define", args: {} }],
  };
  expect((await parse(["--define==v"], spec)).options.options).toEqual(map({ "--define": ["v"] }));
  expect((await parse(["--define=v==w"], spec)).options.options).toEqual(map({ "--define": ["v==w"] }));
});

test("parse: a repeatable option with an argument collects a value from each use", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-I", "--include"], isRepeatable: true, args: {} }],
  };
  expect((await parse(["-I", "a"], spec)).options.all("-I")).toEqual(["a"]);
  expect((await parse(["-Ia"], spec)).options.all("-I")).toEqual(["a"]);
  expect((await parse(["-I", "a", "-Ib", "--include=c"], spec)).options.options).toEqual(
    map({ "-I": ["a", "b", "c"], "--include": ["a", "b", "c"] }),
  );
});

test("parse: a repeatable option with an argument still limits its uses", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-I", isRepeatable: 2, args: {} }],
  };
  expect((await parse(["-I", "a", "-I", "b"], spec)).options.all("-I")).toEqual(["a", "b"]);
  await expect(parse(["-I", "a", "-I", "b", "-I", "c"], spec)).rejects.toThrow("Too many repetitions");
});

test("parse: a repeatable option with a required argument rejects a missing value", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-I", isRepeatable: true, args: {} }],
  };
  await expect(parse(["-I"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(tooFewOptionArguments),
  });
});

test("parse: an empty argument doesn't prefix-match a subcommand", async () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "build" }],
  };
  const result = await parse([""], spec);
  expect(result.path).toEqual([spec]);
  expect(result.args).toEqual([""]);
});

test("parse: a subcommand can turn off optionsMustPrecedeArguments", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionsMustPrecedeArguments: true },
    subcommands: [
      {
        name: "sub",
        args: { isVariadic: true },
        parserDirectives: { optionsMustPrecedeArguments: false },
        options: [{ name: "-v" }],
      },
    ],
  };
  const result = await parse(["sub", "a", "-v"], spec);
  expect(result.args).toEqual(["a"]);
  expect(result.options.options).toEqual(map({ "-v": [] }));
});

test("parse: a subcommand can turn off subcommandsMatchUniquePrefix", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      {
        name: "sub",
        args: { isOptional: true },
        parserDirectives: { subcommandsMatchUniquePrefix: false },
        subcommands: [{ name: "build" }],
      },
    ],
  };
  const result = await parse(["sub", "bu"], spec);
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
  expect(result.args).toEqual(["bu"]);
});

test("parse: a dependsOn error joins the option's aliases with a slash", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-a", "--all"], dependsOn: ["-b"] }, { name: "-b" }],
  };
  await expect(parse(["--all"], spec)).rejects.toThrow("-a/--all requires -b");
});

test("parse: an exclusiveOn error joins the option's aliases with a slash", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-a", "--all"], exclusiveOn: ["-b"] }, { name: "-b" }],
  };
  await expect(parse(["--all", "-b"], spec)).rejects.toThrow("-a/--all can't be used together with -b");
});

/** Run `fn`, which must reject, and return what it rejected with. */
async function thrown(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a throw");
}

test("parse: an unknown option in a chain names its character", async () => {
  const spec: Spec = { name: "test", args: { isOptional: true }, options: [{ name: "-v" }] };
  const error = await thrown(() => parse(["x", "-vx"], spec));
  expect((error as ParseError).message).toBe('"-x" looks like a flag, but is unknown in this context');
});

test("parse: an unknown long option's name leaves out its attached value", async () => {
  const spec: Spec = { name: "test", args: { isOptional: true }, options: [{ name: "--known" }] };
  const error = await thrown(() => parse(["a", "--nope=1"], spec));
  expect((error as Error).message).toBe('"--nope" looks like a flag, but is unknown in this context');
});

test("parse: a value attached to an option without args names the option", async () => {
  const spec: Spec = { name: "test", options: [{ name: ["-v", "--verbose"] }] };
  const error = await thrown(() => parse(["--verbose=1"], spec));
  expect((error as ParseError).message).toMatch(takesNoArguments);
  expect((error as Error).message).toBe("Option --verbose doesn't take arguments");
});

test("parse: too many arguments names the first extra one, including after '--'", async () => {
  const spec: Spec = { name: "test", args: {} };
  const error = await thrown(() => parse(["--", "a", "b"], spec));
  expect((error as ParseError).message).toMatch(tooManyArguments);
  expect((error as Error).message).toBe('Too many arguments, "b" was unexpected');
});

test("parse: an unknown option lists the valid names and the command it was found in", async () => {
  const sub: Subcommand = {
    name: "sub",
    options: [{ name: "--x" }, { name: "--g", isPersistent: true }],
  };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--g", isPersistent: true }, { name: "--local" }, { name: "--g2", isPersistent: true }],
    subcommands: [sub],
  };
  const error = await thrown(() => parse(["sub", "--nope"], spec));
  expect((error as ParseError).message).toMatch(unknownOption);
  // Local names first, then persistent ones, each listed once, in the order
  // the options they refer to are defined. The parent's non-persistent option
  // isn't valid in the subcommand, and its `--g` is shadowed by the
  // subcommand's.
  expect((error as ParseError).didYouMean?.choices).toEqual([["--x"], ["--g2"], ["--g"]]);
  expect((error as ParseError).context.path).toEqual([spec, sub]);
});

test("parse: an option missing values before a subcommand reports the command it was used in", async () => {
  const sub: Subcommand = { name: "sub" };
  const spec: Spec = { name: "test", options: [{ name: "--pair", args: [{}, {}] }], subcommands: [sub] };
  const error = await thrown(() => parse(["--pair=a", "sub"], spec));
  expect((error as ParseError).message).toMatch(tooFewOptionArguments);
  expect((error as ParseError).context.path).toEqual([spec]);
});

test("parse: an unknown option doesn't suggest hidden options", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--secret-mode", hidden: true }, { name: "--verbose" }],
  };
  const error = await thrown(() => parse(["--secret-mod"], spec));
  expect((error as ParseError).didYouMean?.choices).toEqual([["--verbose"]]);
});

test("parse: missing argument messages describe the expected count", async () => {
  const message = async (args: Spec["args"], input: string[]) => {
    const error = await thrown(() => parse(input, { name: "test", args }));
    expect((error as ParseError).message).toMatch(tooFewArguments);
    return (error as Error).message;
  };
  expect(await message({}, [])).toBe("Expected 1 argument");
  expect(await message([{}, {}], ["a"])).toBe("Expected 2 arguments");
  expect(await message([{}, { isOptional: true }], [])).toBe("Expected between 1 and 2 arguments");
  expect(await message([{}, {}, { isVariadic: true, isOptional: true }], [])).toBe(
    "Expected at least 2 arguments",
  );
});

test("parse: missing option value messages describe the expected count", async () => {
  const message = async (args: Option["args"]) => {
    const error = await thrown(() => parse(["--o", "a"], { name: "test", options: [{ name: "--o", args }] }));
    expect((error as ParseError).message).toMatch(tooFewOptionArguments);
    return (error as Error).message;
  };
  expect(await message([{}, {}])).toBe("Option --o needs 2 arguments");
  expect(await message([{}, {}, { isOptional: true }])).toBe("Option --o needs between 2 and 3 arguments");
  expect(await message([{}, {}, { isVariadic: true, isOptional: true }])).toBe(
    "Option --o needs at least 2 arguments",
  );
});

test("parse: '--' with no room for arguments explains itself", async () => {
  await expect(parse(["--"], { name: "test" })).rejects.toThrow(
    "Unexpected argument '--', did you mean to use an option instead?",
  );
});

test("parse: a subcommand inherits option arg separators", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--g", args: {}, isPersistent: true }],
    subcommands: [{ name: "sub" }],
  };
  expect((await parse(["sub", "--g:1"], spec)).options.options).toEqual(map({ "--g": ["1"] }));
  await expect(parse(["sub", "--g=1"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
});

test("parse: a subcommand's separators apply to inherited options", async () => {
  const sub: Subcommand = { name: "sub", parserDirectives: { optionArgSeparators: "=" } };
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--g", args: {}, isPersistent: true }],
    subcommands: [sub],
  };
  expect((await parse(["sub", "--g=1"], spec)).options.options).toEqual(map({ "--g": ["1"] }));
  await expect(parse(["sub", "--g:1"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
  // Before the subcommand, the parent's separators are still in effect.
  const before = await parse(["--g:1", "sub"], spec);
  expect(before.path).toEqual([spec, sub]);
  expect(before.options.options).toEqual(map({ "--g": ["1"] }));
});

test("parse: an empty list of separators turns off attached values", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--g", args: {}, isPersistent: true }],
    subcommands: [
      {
        name: "sub",
        parserDirectives: { optionArgSeparators: [] },
        options: [{ name: "-o", args: {} }],
      },
    ],
  };
  await expect(parse(["sub", "--g=1"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
  expect((await parse(["sub", "--g", "1"], spec)).options.options).toEqual(map({ "--g": ["1"] }));
  // A short option's value starts right after its name.
  expect((await parse(["sub", "-o=1"], spec)).options.options).toEqual(map({ "-o": ["=1"] }));
});

test("parse: a subcommand can turn off flagsArePosixNoncompliant", async () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
    subcommands: [
      {
        name: "sub",
        args: { isOptional: true },
        parserDirectives: { flagsArePosixNoncompliant: false },
        options: [{ name: "-a" }, { name: "-b" }],
      },
    ],
  };
  expect((await parse(["--x"], spec)).args).toEqual(["--x"]);
  await expect(parse(["sub", "--x"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(unknownOption),
  });
  expect((await parse(["sub", "-ab"], spec)).options.options).toEqual(map({ "-a": [], "-b": [] }));
});

test("parse: a POSIX-noncompliant option takes an attached value", async () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "out", args: {} }, { name: "flag" }],
  };
  const result = await parse(["out=x", "y"], spec);
  expect(result.options.options).toEqual(map({ out: ["x"] }));
  expect(result.args).toEqual(["y"]);
  const error = await thrown(() => parse(["flag=x"], spec));
  expect((error as ParseError).message).toBe("Option flag doesn't take arguments");
});

test("parse: a short option's value starts after the first listed separator it begins with", async () => {
  const option = { name: "-o", args: {} };
  const value = async (separators: readonly [string, string]) =>
    (
      await parse(["-o:=v"], {
        name: "test",
        parserDirectives: { optionArgSeparators: separators },
        options: [option],
      })
    ).options.get("-o");
  expect(await value([":", ":="])).toBe("=v");
  expect(await value([":=", ":"])).toBe("v");
});

test("parse: a repeated option breaks each of its rules once", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--out", args: {} },
      { name: "-v", isRepeatable: true, dependsOn: ["--out"], exclusiveOn: ["-q", "--quiet"] },
      { name: ["-q", "--quiet"], exclusiveOn: ["-v"] },
    ],
  };
  const messages = async (argv: string[]) =>
    parse(argv, spec).then(
      () => [],
      (error: ParseError) => (error.problems ?? [error]).map((problem) => problem.message),
    );
  expect(await messages(["-v", "-v"])).toEqual(["-v requires --out, add it to fix this error"]);
  expect(await messages(["--out", "x", "-vv", "-q", "-v"])).toEqual(["-v can't be used together with -q"]);
  expect(await messages(["--out", "x", "-q", "-v"])).toEqual(["-q/--quiet can't be used together with -v"]);
});

test("parse: option rules are checked dependsOn, then exclusiveOn, then required", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--out", args: {}, isRequired: true },
      { name: ["-v", "--verbose"], dependsOn: ["--out"] },
      { name: "-q", exclusiveOn: ["-v"] },
    ],
  };
  await expect(parse(["-v", "-q"], spec)).rejects.toThrow(
    "-v/--verbose requires --out, add it to fix this error",
  );
  await expect(parse(["--out", "x", "-v", "-q"], spec)).rejects.toThrow("-q can't be used together with -v");
  await expect(parse([], spec)).rejects.toThrow("Option --out is required, but wasn't found");
});

test("parse: a short option's attached value can follow any configured separator", async () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: [":", "="] },
    options: [{ name: "-o", args: {} }],
  };
  expect((await parse(["-o:1"], spec)).options.options).toEqual(map({ "-o": ["1"] }));
  expect((await parse(["-o=1"], spec)).options.options).toEqual(map({ "-o": ["1"] }));
  expect((await parse(["-o1"], spec)).options.options).toEqual(map({ "-o": ["1"] }));
});

test("parse: a '+' option takes an attached value after a separator", async () => {
  const spec: Spec = { name: "test", options: [{ name: "+o", args: {} }] };
  expect((await parse(["+o=1"], spec)).options.options).toEqual(map({ "+o": ["1"] }));
});

test("parse: an optional value in the middle of a chain takes the rest of the token", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: { isOptional: true } }, { name: "-c" }],
  };
  expect((await parse(["-abc"], spec)).options.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: an option waiting for a value takes unknown option-like tokens", async () => {
  const spec: Spec = { name: "test", options: [{ name: "-o", args: {} }, { name: "-v" }] };
  expect((await parse(["-o", "-5"], spec)).options.options).toEqual(map({ "-o": ["-5"] }));
  expect((await parse(["-o", "--x"], spec)).options.options).toEqual(map({ "-o": ["--x"] }));
  await expect(parse(["-o", "-v"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(tooFewOptionArguments),
  });
  await expect(parse(["-o", "--"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(tooFewOptionArguments),
  });
});

test("parse: requiresSeparator string rejects a short option's unseparated value", async () => {
  const spec: Spec = { name: "test", options: [{ name: "-q", args: {}, requiresSeparator: "=" }] };
  expect((await parse(["-q=val"], spec)).options.options).toEqual(map({ "-q": ["val"] }));
  await expect(parse(["-qval"], spec)).rejects.toThrow(/Incorrect separator, use '='/);
});

test("parse: a repeatable persistent option with an argument shares its uses with subcommands", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--tag", args: {}, isRepeatable: 2, isPersistent: true }],
    subcommands: [{ name: "sub" }],
  };
  expect((await parse(["--tag", "a", "sub", "--tag", "b"], spec)).options.options).toEqual(
    map({ "--tag": ["a", "b"] }),
  );
  await expect(parse(["--tag", "a", "sub", "--tag", "b", "--tag", "c"], spec)).rejects.toThrow(
    "Too many repetitions",
  );
});

test("parse: a repeatable option with a variadic argument collects every use's values", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--p", args: { isVariadic: true }, isRepeatable: true }],
  };
  expect((await parse(["--p", "a", "b", "--p", "c"], spec)).options.options).toEqual(
    map({ "--p": ["a", "b", "c"] }),
  );
});

test("parse: each use of a repeatable option needs its own arguments", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--p", args: [{}, {}], isRepeatable: true }],
  };
  expect((await parse(["--p", "a", "b", "--p", "c", "d"], spec)).options.options).toEqual(
    map({ "--p": ["a", "b", "c", "d"] }),
  );
  await expect(parse(["--p", "a", "b", "--p", "c"], spec)).rejects.toThrow("Option --p needs 2 arguments");
});

test("parse: a variadic option value takes a subcommand's name", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--files", args: { isVariadic: true } },
      { name: "--maybe", args: { isVariadic: true, isOptional: true } },
    ],
    subcommands: [{ name: "build" }],
  };
  const required = await parse(["--files", "a", "build"], spec);
  expect(required.path).toEqual([spec]);
  expect(required.options.options).toEqual(map({ "--files": ["a", "build"] }));
  const optional = await parse(["--maybe", "build"], spec);
  expect(optional.path).toEqual([spec]);
  expect(optional.options.options).toEqual(map({ "--maybe": ["build"] }));
});

test("parse: a command that requires a subcommand reports a stray argument as an unknown command", async () => {
  const spec: Spec = { name: "test", requiresSubcommand: true, subcommands: [{ name: "add" }] };
  const error = await thrown(() => parse(["ad", "extra"], spec));
  expect(error).toBeInstanceOf(ParseError);
  expect((error as ParseError).message).toBe("Unknown command 'ad'");
  expect((error as ParseError).didYouMean).toEqual({ input: "ad", choices: [["add"]] });
  await expect(parse([""], spec)).rejects.toThrow("Expected a command, but the value was empty");
  // Its own action doesn't take the stray arguments either.
  await expect(parse(["ad"], { ...spec, action: () => {} })).rejects.toThrow("Unknown command 'ad'");
});

test("parse: an ambiguous prefix is reported with the commands it could be", async () => {
  const spec: Spec = {
    name: "test",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "status" }, { name: ["stash", "st"] }, { name: "store", hidden: true }],
  };
  await expect(parse(["sta"], spec)).rejects.toThrow("Ambiguous command 'sta', could be: status, stash");
});

test("parse: a prefix of several names of one command is unique", async () => {
  const status: Subcommand = { name: ["status", "stat"] };
  const build: Subcommand = { name: ["build", "b"] };
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [status, build, { name: "bundle" }],
  };
  expect((await parse(["sta"], spec)).path).toEqual([spec, status]);
  expect((await parse(["bui"], spec)).path).toEqual([spec, build]);
});

test("parse: a hidden command only matches its exact name in prefix mode", async () => {
  const build: Subcommand = { name: "build" };
  const bundle: Subcommand = { name: "bundle", hidden: true };
  const spec: Spec = {
    name: "test",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [build, bundle],
  };
  expect((await parse(["bu"], spec)).path).toEqual([spec, build]);
  expect((await parse(["bundle"], spec)).path).toEqual([spec, bundle]);
  const error = await thrown(() => parse(["bun"], spec));
  expect((error as ParseError).message).toBe("Unknown command 'bun'");
  expect((error as ParseError).didYouMean?.choices).toEqual([["build"]]);
});

test("parse: an empty token matches a command with an empty name", async () => {
  const empty: Subcommand = { name: "" };
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "remote" }, empty],
  };
  expect((await parse([""], spec)).path).toEqual([spec, empty]);
});

test("parse: a command without room for arguments reports a mistyped subcommand", async () => {
  const spec: Spec = { name: "test", action: () => {}, subcommands: [{ name: "build" }] };
  const error = await thrown(() => parse(["biuld"], spec));
  expect((error as ParseError).message).toBe("Unknown command 'biuld'");
  expect((error as ParseError).didYouMean?.choices).toEqual([["build"]]);
  // Once an argument is found, a later one is just too many.
  const withArg: Spec = { ...spec, args: {} };
  await expect(parse(["a", "b"], withArg)).rejects.toMatchObject({
    message: expect.stringMatching(tooManyArguments),
  });
  // An option action still runs.
  const helpAction: Action = () => {};
  const withHelp: Spec = { ...spec, options: [{ name: "--help", action: helpAction }] };
  expect((await parse(["biuld", "--help"], withHelp)).action).toBe(helpAction);
});

test("parse: an option action skips required arguments and options", async () => {
  const helpAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    args: {},
    options: [
      { name: "--help", action: helpAction },
      { name: "--r", isRequired: true },
    ],
  };
  const result = await parse(["--help"], spec);
  expect(result.args).toEqual([]);
  expect(result.action).toBe(helpAction);
});

test("parse: a value attached to a short option without args says it takes none", async () => {
  const spec: Spec = { name: "test", options: [{ name: ["-v", "--verbose"] }] };
  const error = await thrown(() => parse(["-v=1"], spec));
  expect((error as ParseError).message).toBe("Option -v doesn't take arguments");
  // An option named like the separator still chains.
  const chained: Spec = { name: "test", options: [{ name: "-v" }, { name: "-=" }] };
  expect((await parse(["-v="], chained)).options.options).toEqual(map({ "-v": [], "-=": [] }));
});

test("parse: requiresSeparator true rejects a short option's unseparated value", async () => {
  const spec: Spec = { name: "test", options: [{ name: "-o", args: {}, requiresSeparator: true }] };
  expect((await parse(["-o=val"], spec)).options.options).toEqual(map({ "-o": ["val"] }));
  await expect(parse(["-oval"], spec)).rejects.toThrow("Missing separator, use '=' between -o and its value");
});

test("parse: an option action skips argument count and option relationship checks", async () => {
  const helpAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--help", action: helpAction },
      { name: "--a", dependsOn: ["--b"] },
      { name: "--b" },
      { name: "--c", exclusiveOn: ["--b"] },
    ],
  };
  expect((await parse(["a", "b", "--help"], spec)).action).toBe(helpAction);
  expect((await parse(["--help", "--a"], spec)).action).toBe(helpAction);
  expect((await parse(["--help", "--b", "--c"], spec)).action).toBe(helpAction);
  // Without the action, each of these is still an error.
  await expect(parse(["a"], spec)).rejects.toMatchObject({
    message: expect.stringMatching(tooManyArguments),
  });
  await expect(parse(["--a"], spec)).rejects.toThrow("--a requires --b");
  await expect(parse(["--b", "--c"], spec)).rejects.toThrow("--c can't be used together with --b");
});

test("parse: a command that shows usage for a missing subcommand skips required options", async () => {
  const spec: Spec = {
    name: "test",
    requiresSubcommand: true,
    options: [{ name: "--token", isPersistent: true, isRequired: true }],
    subcommands: [{ name: "a" }],
  };
  expect((await parse([], spec)).action).toBeUndefined();
  await expect(parse(["a"], spec)).rejects.toMatchObject({ message: expect.stringMatching(missingOption) });
});

test("parse: a command that requires a subcommand accepts '--' alone, but no argument after it", async () => {
  const spec: Spec = { name: "test", requiresSubcommand: true, subcommands: [{ name: "a" }] };
  const result = await parse(["--"], spec);
  expect(result.action).toBeUndefined();
  expect(result.argSeparatorIndex).toBe(0);
  await expect(parse(["--", "a"], spec)).rejects.toThrow('Too many arguments, "a" was unexpected');
  const action: Action = () => {};
  expect((await parse(["--"], { ...spec, action })).action).toBe(action);
});

test("parse: '--' after an argument is an argument when options must precede arguments", async () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { optionsMustPrecedeArguments: true },
  };
  const result = await parse(["a", "--", "b"], spec);
  expect(result.args).toEqual(["a", "--", "b"]);
  expect(result.argSeparatorIndex).toBe(-1);
  // Before any argument, it still ends the options.
  expect((await parse(["--", "-x"], spec)).argSeparatorIndex).toBe(0);
});

test("parse: an attached value is the option's only value", async () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    options: [
      { name: "--two", args: [{}, {}] },
      { name: "--many", args: { isVariadic: true } },
      { name: "-m", args: { isVariadic: true } },
    ],
  };
  await expect(parse(["--two=a", "b"], spec)).rejects.toThrow("Option --two needs 2 arguments");
  for (const input of [
    ["--many=a", "b"],
    ["-ma", "b"],
  ]) {
    const result = await parse(input, spec);
    expect([...result.options.options.values()]).toEqual([["a"]]);
    expect(result.args).toEqual(["b"]);
  }
});

/** What `has`, `get`, `all` and `count` say about `name`, in that order. */
function answers(options: OptionArgs<unknown>, name: string): [boolean, unknown, unknown[], number] {
  return [options.has(name), options.get(name), options.all(name), options.count(name)];
}

test("options: a bare flag is there with no values", async () => {
  const spec: Spec = { name: "test", options: [{ name: ["-f", "--force"] }, { name: "--dry-run" }] };
  const { options } = await parse(["-f"], spec);
  // A flag that isn't repeatable stores no values, and counts once however often it's given.
  expect(answers(options, "-f")).toEqual([true, undefined, [], 1]);
  expect(answers(options, "--force")).toEqual([true, undefined, [], 1]);
  expect(answers((await parse(["-f", "--force"], spec)).options, "-f")).toEqual([true, undefined, [], 1]);
  expect(answers(options, "--dry-run")).toEqual([false, undefined, [], 0]);
});

test("options: count gives the uses of a repeatable option without arguments", async () => {
  const spec: Spec = { name: "test", options: [{ name: ["-v", "--verbose"], isRepeatable: true }] };
  const { options } = await parse(["-vv", "--verbose"], spec);
  expect(answers(options, "-v")).toEqual([true, "", ["", "", ""], 3]);
  expect(answers(options, "--verbose")).toEqual([true, "", ["", "", ""], 3]);
  expect(answers((await parse([], spec)).options, "-v")).toEqual([false, undefined, [], 0]);
});

test("options: a repeatable option with arguments gives the values of every use", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: ["-I", "--include"], isRepeatable: true, args: {} },
      { name: "--pair", isRepeatable: true, args: [{}, {}] },
    ],
  };
  const { options } = await parse(["-I", "a", "--include=b", "--pair", "x", "y"], spec);
  expect(answers(options, "-I")).toEqual([true, "a", ["a", "b"], 2]);
  expect(answers(options, "--include")).toEqual([true, "a", ["a", "b"], 2]);
  // count counts values, so one use with two arguments counts 2.
  expect(answers(options, "--pair")).toEqual([true, "x", ["x", "y"], 2]);
});

test("options: get and all give the defaults of an unused option", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--port", args: { default: "8080" } },
      { name: "--size", args: [{ default: "80" }, { isOptional: true, default: "24" }] },
      { name: "--host", args: {} },
    ],
  };
  const { options } = await parse([], spec);
  expect(answers(options, "--port")).toEqual([false, "8080", ["8080"], 0]);
  expect(answers(options, "--size")).toEqual([false, "80", ["80", "24"], 0]);
  expect(answers(options, "--host")).toEqual([false, undefined, [], 0]);
  expect(answers(options, "--nope")).toEqual([false, undefined, [], 0]);
  expect(answers((await parse(["--port", "1"], spec)).options, "--port")).toEqual([true, "1", ["1"], 1]);
});

test("options: an option whose first argument is optional only gets its default when it's bare", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--color", args: { isOptional: true, default: "auto" } },
      { name: "--log", args: { isOptional: true } },
    ],
  };
  expect(answers((await parse([], spec)).options, "--color")).toEqual([false, undefined, [], 0]);
  expect(answers((await parse(["--color"], spec)).options, "--color")).toEqual([true, "auto", ["auto"], 1]);
  expect(answers((await parse(["--color", "never"], spec)).options, "--color")).toEqual([
    true,
    "never",
    ["never"],
    1,
  ]);
  expect(answers((await parse(["--log"], spec)).options, "--log")).toEqual([true, undefined, [], 1]);
});

test("options: an option shared with a parent command answers after the subcommand", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: ["-v", "--verbose"], isRepeatable: true, isPersistent: true },
      { name: "--out", args: { default: "dist" }, isPersistent: true },
      { name: "-C", args: {} },
    ],
    subcommands: [{ name: "build" }],
  };
  const { options } = await parse(["-v", "-C", "/repo", "build", "-v"], spec);
  expect(answers(options, "--verbose")).toEqual([true, "", ["", ""], 2]);
  // The selected command finds the default of a persistent option nobody used.
  expect(answers(options, "--out")).toEqual([false, "dist", ["dist"], 0]);
  // A parent's option used before the subcommand still answers there.
  expect(answers(options, "-C")).toEqual([true, "/repo", ["/repo"], 1]);
  expect(answers((await parse(["build", "--out", "x"], spec)).options, "--out")).toEqual([
    true,
    "x",
    ["x"],
    1,
  ]);
});

test("options: each name answers for the option that last took it", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-o", "--output"], args: { default: "root" }, isPersistent: true }],
    subcommands: [{ name: "sub", options: [{ name: "-o", args: { default: "sub" } }] }],
  };
  // At sub, -o is the local option, and --output is still the persistent one.
  const unused = (await parse(["sub"], spec)).options;
  expect(answers(unused, "-o")).toEqual([false, "sub", ["sub"], 0]);
  expect(answers(unused, "--output")).toEqual([false, "root", ["root"], 0]);
  const local = (await parse(["sub", "-o", "x"], spec)).options;
  expect(answers(local, "-o")).toEqual([true, "x", ["x"], 1]);
  expect(answers(local, "--output")).toEqual([false, "root", ["root"], 0]);
  // Using the persistent option stores its values under each of its names,
  // so -o answers with them until the local option is used.
  expect(answers((await parse(["--output", "y", "sub"], spec)).options, "-o")).toEqual([true, "y", ["y"], 1]);
  const both = (await parse(["--output", "y", "sub", "-o", "x"], spec)).options;
  expect(answers(both, "-o")).toEqual([true, "x", ["x"], 1]);
  expect(answers(both, "--output")).toEqual([true, "y", ["y"], 1]);
});

test("options: each question works when an action takes it off the object", async () => {
  const spec: Spec = { name: "test", options: [{ name: "--port", args: { default: "8080" } }] };
  const { options, has, get, all, count } = (await parse(["--port", "1"], spec)).options;
  expect([has("--port"), get("--port"), all("--port"), count("--port")]).toEqual([true, "1", ["1"], 1]);
  expect(options).toEqual(map({ "--port": ["1"] }));
});

test("options: an option with a ref is read by it, whichever option used a shared name last", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-v", "--verbose"], isPersistent: true, isRepeatable: true, ref: "verbose" }],
    subcommands: [
      {
        name: "sub",
        options: [{ name: ["-v", "--version"], ref: "version", args: { name: "v", default: "1" } }],
      },
    ],
  };
  const both = (await parse(["-vv", "sub", "-v", "2"], spec)).options;
  expect(answers(both, "verbose")).toEqual([true, "", ["", ""], 2]);
  expect(answers(both, "version")).toEqual([true, "2", ["2"], 1]);
  // The shared name holds the option used last.
  expect(both.all("-v")).toEqual(["2"]);

  const parent = (await parse(["-v", "sub"], spec)).options;
  expect(answers(parent, "verbose")).toEqual([true, "", [""], 1]);
  // An unused option's defaults are found by its ref.
  expect(answers(parent, "version")).toEqual([false, "1", ["1"], 0]);

  const neither = (await parse(["sub"], spec)).options;
  expect(answers(neither, "verbose")).toEqual([false, undefined, [], 0]);
  expect(answers(neither, "version")).toEqual([false, "1", ["1"], 0]);
});

test("options: options on sibling commands with the same ref are each read by it", async () => {
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: { name: "path" }, ref: "directory" }],
    subcommands: [
      { name: "switch", args: { name: "branch" }, options: [{ name: "-C", ref: "create" }] },
      { name: "branch", args: { name: "names", isVariadic: true }, options: [{ name: "-C", ref: "create" }] },
    ],
  };
  const options = (await parse(["-C", "dir", "switch", "-C", "topic"], spec)).options;
  expect(answers(options, "directory")).toEqual([true, "dir", ["dir"], 1]);
  expect(answers(options, "create")).toEqual([true, undefined, [], 1]);
  expect((await parse(["-C", "dir", "branch", "old", "new"], spec)).options.has("create")).toBe(false);
});

test("parse: dependsOn and exclusiveOn only count an option in scope where the option is used", async () => {
  // `--root` isn't persistent, so `sub` can't use it, and its options can't refer to it.
  const spec: Spec = {
    name: "test",
    options: [{ name: "--root" }, { name: "--all", isPersistent: true }],
    subcommands: [
      {
        name: "sub",
        options: [
          { name: "--needs-root", dependsOn: ["--root"] },
          { name: "--not-root", exclusiveOn: ["--root"] },
          { name: "--needs-all", dependsOn: ["--all"] },
          { name: "--not-all", exclusiveOn: ["--all"] },
        ],
      },
    ],
  };
  await expect(parse(["--root", "sub", "--needs-root"], spec)).rejects.toThrow(
    "--needs-root requires --root",
  );
  await parse(["--root", "sub", "--not-root"], spec);
  await parse(["--all", "sub", "--needs-all"], spec);
  await expect(parse(["--all", "sub", "--not-all"], spec)).rejects.toThrow(
    "--not-all can't be used together with --all",
  );
});

test("parse: an option's rules refer to the options its own command can use", async () => {
  // `-v` means the root's option to `--a`, and a different option inside `sub`.
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--a", dependsOn: ["-v"] },
      { name: "--b", exclusiveOn: ["-v"] },
      { name: ["-v", "--verbose"], isPersistent: true, ref: "verbose" },
    ],
    subcommands: [{ name: "sub", options: [{ name: ["-v", "--version"], ref: "version" }] }],
  };
  await parse(["--a", "-v", "sub"], spec);
  await parse(["--a", "sub", "--verbose"], spec);
  await expect(parse(["--a", "sub", "-v"], spec)).rejects.toThrow("--a requires -v");
  await parse(["--b", "sub", "-v"], spec);
  await expect(parse(["--b", "sub", "--verbose"], spec)).rejects.toThrow(
    "--b can't be used together with -v",
  );
});
