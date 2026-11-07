import { expect, test } from "vitest";

import { usage } from "../src/subcommands.js";
import {
  InvalidOptionArg,
  MissingRequiredOption,
  ParseError,
  TooFewArguments,
  TooFewOptionArguments,
  TooManyArguments,
  UnknownOption,
} from "../src/errors.js";
import { parse } from "../src/parse.js";
import { getMaxArgs, getMinArgs } from "../src/util.js";
import type { Action, Option, Spec, Subcommand } from "../src/types.js";
import { map } from "./helpers.js";

test("getMinArgs", () => {
  expect(getMinArgs([])).toBe(0);
  expect(getMinArgs([{}])).toBe(1);
  expect(getMinArgs([{}, {}])).toBe(2);
  expect(getMinArgs([{}, { isOptional: true }])).toBe(1);
  expect(getMinArgs([{ isOptional: true }])).toBe(0);
  expect(getMinArgs([{ isOptional: true }, {}])).toBe(0);
  // Accepts the raw spec value (scalar / undefined) without an array copy.
  expect(getMinArgs(undefined)).toBe(0);
  expect(getMinArgs({})).toBe(1);
  expect(getMinArgs({ isOptional: true })).toBe(0);
});

test("getMaxArgs", () => {
  expect(getMaxArgs([])).toBe(0);
  expect(getMaxArgs([{}])).toBe(1);
  expect(getMaxArgs([{}, {}])).toBe(2);
  expect(getMaxArgs([{}, { isVariadic: true }])).toBe(Infinity);
  expect(getMaxArgs([{ isVariadic: true }])).toBe(Infinity);
  expect(getMaxArgs([{ isVariadic: true }, {}])).toBe(Infinity);
  expect(getMaxArgs(undefined)).toBe(0);
  expect(getMaxArgs({})).toBe(1);
  expect(getMaxArgs({ isVariadic: true })).toBe(Infinity);
});

test("parse: no args and no values executes action", () => {
  const result = parse([], { name: "test" });
  expect(result.args).toEqual([]);
});

test("parse: one arg with one value succeeds", () => {
  const result = parse(["value"], { name: "test", args: {} });
  expect(result.args).toEqual(["value"]);
});

test("parse: no args with one value fails", () => {
  expect(() => parse(["value"], { name: "test" })).toThrow();
});

test("parse: one arg with two values fails", () => {
  expect(() => parse(["value1", "value2"], { name: "test", args: {} })).toThrow();
});

test("parse: single arg with no values fails", () => {
  expect(() => parse([], { name: "test", args: {} })).toThrow();
});

test("parse: two args arg with one value fails", () => {
  const spec: Spec = {
    name: "test",
    args: [{ name: "arg1" }, { name: "arg2" }],
  };
  expect(() => parse(["value"], spec)).toThrow();
});

test("parse: two args with two values succeeds", () => {
  const result = parse(["value1", "value2"], {
    name: "test",
    args: [{}, {}],
  });
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: variadic arg succeeds with one value", () => {
  const result = parse(["value1", "value2", "value3"], {
    name: "test",
    args: { isVariadic: true },
  });
  expect(result.args).toEqual(["value1", "value2", "value3"]);
});

test("parse: variadic arg fails with zero values", () => {
  expect(() => parse([], { name: "test", args: { isVariadic: true } })).toThrow();
});

test("parse: variadic+optional arg succeeds with zero values", () => {
  const result = parse([], {
    name: "test",
    args: { isVariadic: true, isOptional: true },
  });
  expect(result.args).toEqual([]);
});

test("parse: options without args are [] when present", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: ["--present", "--alias"] },
      { name: "--missing" },
      { name: ["--another", "--another-alias"] },
    ],
  };
  const result = parse(["--present"], spec);
  expect(result.options).toEqual(
    map({
      "--present": [],
      "--alias": [],
    }),
  );
});

test("parse: options and args can be interspersed", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option" }],
    args: [{}, {}],
  };
  const result = parse(["value1", "--option", "value2"], spec);
  expect(result.options).toEqual(map({ "--option": [] }));
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: options can have values as the next argument", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: [{ name: "arg1" }, { name: "arg2" }],
  };
  const result = parse(["value1", "--arg", "optionargval", "value2"], spec);
  expect(result.options).toEqual(map({ "--arg": ["optionargval"] }));
  expect(result.args).toEqual(["value1", "value2"]);
});

test("parse: options can take multiple arguments", () => {
  const spec: Spec = {
    name: "test",
    options: [
      {
        name: "--arg",
        args: [{ name: "optionarg1" }, { name: "optionarg2" }],
      },
    ],
  };
  const result = parse(["--arg", "value1", "value2"], spec);
  expect(result.options).toEqual(map({ "--arg": ["value1", "value2"] }));
});

test("parse: action on spec gets returned", () => {
  const action: Action = () => {};
  const result = parse([], { name: "test", action });
  expect(result.actions).toEqual([action]);
});

test("parse: action on subcommand gets returned", () => {
  const specAction: Action = () => {};
  const subcommandAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    action: specAction,
    subcommands: [{ name: "example", action: subcommandAction }],
  };
  const result = parse(["example"], spec);
  expect(result.actions).toEqual([specAction, subcommandAction]);
});

test("parse: action on option is preferred to spec action", () => {
  const specAction: Action = () => {};
  const optionAction: Action = () => {};
  const spec: Spec = {
    name: "test",
    action: specAction,
    options: [{ name: "--option", action: optionAction }],
  };
  const result = parse(["--option"], spec);
  expect(result.actions).toEqual([specAction]);
  expect(result.optionActions).toEqual([optionAction]);
});

test("parse: final option action is preferred", () => {
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
  const result = parse(["--option", "--final"], spec);
  expect(result.actions).toEqual([specAction]);
  expect(result.optionActions).toEqual([optionAction, finalAction]);
});

test("parse: option actions allow incorrect arguments", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--option", action: () => {} }],
    args: {},
  };
  parse(["--option"], spec);
});

test("parse: option arguments can be separated with an equals", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
  };
  const result = parse(["--arg=value", "test"], spec);
  expect(result.options).toEqual(map({ "--arg": ["value"] }));
  expect(result.args).toEqual(["test"]);
});

test("parse: option arg separator cannot be used with more than 1 arg", () => {
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
  const result = parse(["--plain=value", "--empty=", "--optional=value", "--variadic=value"], spec);
  expect(result.options).toEqual(
    map({
      "--plain": ["value"],
      "--empty": [""],
      "--optional": ["value"],
      "--variadic": ["value"],
    }),
  );
  expect(() => parse(["--fail=value"], spec)).toThrow();
});

test("parse: unknown options are rejected", () => {
  const spec: Spec = { name: "test", args: {} };
  expect(() => parse(["-a"], spec)).toThrow();
  expect(() => parse(["-test"], spec)).toThrow();
  expect(() => parse(["--test"], spec)).toThrow();
});

test("parse: '-' is a valid option name", () => {
  const result = parse(["-123"], {
    name: "test",
    options: [{ name: "-", args: {} }],
  });
  expect(result.options).toEqual(map({ "-": ["123"] }));
});

test("parse: '+' is a valid option name", () => {
  const result = parse(["+123"], {
    name: "test",
    options: [{ name: "+", args: {} }],
  });
  expect(result.options).toEqual(map({ "+": ["123"] }));
});

test("parse: '-' option is used if the following character isn't a option", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "-", args: {} },
      { name: "-a", args: {} },
    ],
  };
  expect(parse(["-1a"], spec).options).toEqual(map({ "-": ["1a"] }));
  expect(parse(["-a1"], spec).options).toEqual(map({ "-a": ["1"] }));
});

test("parse: '+' option is used if the following character isn't a option", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "+a", args: {} },
    ],
  };
  expect(parse(["+1a"], spec).options).toEqual(map({ "+": ["1a"] }));
  expect(parse(["+a1"], spec).options).toEqual(map({ "+a": ["1"] }));
});

test("parse: '+' and '-' are treated as args if they aren't valid options", () => {
  const result = parse(["-", "+"], { name: "test", args: [{}, {}] });
  expect(result.args).toEqual(["-", "+"]);
});

test("parse: '+' and '-' are treated as args if there is no argument", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "+", args: {} },
      { name: "-", args: {} },
    ],
    args: [{}, {}],
  };
  const result = parse(["-", "+"], spec);
  expect(result.args).toEqual(["-", "+"]);
  expect(result.options).toEqual(new Map());
});

test("parse: options starting with '+ can be chained", () => {
  const result = parse(["+abc"], {
    name: "test",
    options: [{ name: "+a" }, { name: "+b" }, { name: "+c" }],
  });
  expect(result.options).toEqual(map({ "+a": [], "+b": [], "+c": [] }));
});

test("parse: options starting with a single dash can be chained", () => {
  const result = parse(["-abc"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b" }, { name: "-c" }],
  });
  expect(result.options).toEqual(map({ "-a": [], "-b": [], "-c": [] }));
});

test("parse: chained options can have arguments in the same value with no separator", () => {
  const result = parse(["-abc"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: chained options ignore separators", () => {
  const result = parse(["-ab=c"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: chained options can have arguments in the next token", () => {
  const result = parse(["-ab", "c"], {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: {} }, { name: "-c" }],
  });
  expect(result.options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: tokens starting with '--' that don't match a option is an error", () => {
  expect(() => parse(["--fail"], { name: "test", args: {} })).toThrow();
});

test("parse: POSIX noncompliance disables throwing on unknown options", () => {
  const spec: Spec = {
    name: "test",
    args: {},
    parserDirectives: { flagsArePosixNoncompliant: true },
  };
  expect(parse(["--succeed"], spec).args).toEqual(["--succeed"]);
});

test("parse: POSIX-noncompliant options work as expected", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [
      { name: ["present", "alias"] },
      { name: "missing" },
      { name: ["another", "another-alias"], args: {} },
    ],
  };
  const result = parse(["present", "another=value"], spec);
  expect(result.options).toEqual(
    map({
      present: [],
      alias: [],
      another: ["value"],
      "another-alias": ["value"],
    }),
  );
});

test("parse: option arguments can have another separator", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
  };
  const result = parse(["--arg:value", "test"], spec);
  expect(result.options).toEqual(map({ "--arg": ["value"] }));
  expect(result.args).toEqual(["test"]);
});

test("parse: subcommands are optional", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--arg", args: { name: "optionarg" } }],
    args: {},
    subcommands: [{ name: "subcommand" }],
  };
  const result = parse(["test"], spec);
  expect(result.path).toEqual([spec]);
  expect(result.options).toEqual(new Map());
  expect(result.args).toEqual(["test"]);
});

test("parse: path is correct", () => {
  const two: Subcommand = { name: "two" };
  const one: Subcommand = { name: "one", subcommands: [two] };
  const spec: Spec = { name: "test", subcommands: [one] };
  expect(parse(["one", "two"], spec).path).toEqual([spec, one, two]);
});

test("parse: subcommands are preferred over arguments", () => {
  const subcommand: Subcommand = { name: "subcommand" };
  const spec: Spec = {
    name: "test",
    subcommands: [subcommand],
    args: {},
  };
  const result = parse(["subcommand"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.args).toEqual([]);
});

test("parse: persistent options are carried through into subcommands", () => {
  const subcommand: Subcommand = {
    name: "subcommand",
    options: [{ name: "--sub" }],
  };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--top", isPersistent: true }],
    subcommands: [subcommand],
  };
  const result = parse(["subcommand", "--top"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.args).toEqual([]);
});

test("parse: persistent options can be used before a subcommand", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--persistent", isPersistent: true }],
    subcommands: [{ name: "subcommand" }],
  };
  expect(parse(["--persistent", "subcommand"], spec).options).toEqual(map({ "--persistent": [] }));
});

test("parse: non-persistent options can be used before a subcommand", () => {
  const subcommand: Subcommand = { name: "subcommand" };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--not-persistent" }],
    subcommands: [subcommand],
  };
  const result = parse(["--not-persistent", "subcommand"], spec);
  expect(result.path).toEqual([spec, subcommand]);
  expect(result.options).toEqual(map({ "--not-persistent": [] }));
  expect(() => parse(["subcommand", "--not-persistent"], spec)).toThrow();
});

test("parse: a parent's required option can be supplied before the subcommand", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--req", isRequired: true }],
    subcommands: [{ name: "sub" }],
  };
  expect(parse(["--req", "sub"], spec).path).toHaveLength(2);
  expect(() => parse(["sub", "--req"], spec)).toThrow(UnknownOption);
});

test("parse: an option's value doesn't stop subcommand matching", () => {
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
    const result = parse(input, spec);
    expect(result.path).toEqual([spec, status]);
    expect(result.options).toEqual(map({ "-C": ["/repo"] }));
  }
  expect(() => parse(["status", "-C", "/repo"], spec)).toThrow();
});

test("parse: a persistent option's value doesn't stop subcommand matching", () => {
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
    const result = parse(input, spec);
    expect(result.path).toEqual([spec, evalCommand]);
    expect(result.args).toEqual([]);
    expect(result.options).toEqual(map({ "--features": ["a"] }));
  }
});

test("parse: a required option value can match a subcommand name", () => {
  const status: Subcommand = { name: "status" };
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: {} }],
    subcommands: [status],
  };
  const result = parse(["-C", "status", "status"], spec);
  expect(result.path).toEqual([spec, status]);
  expect(result.options).toEqual(map({ "-C": ["status"] }));
});

test("parse: a subcommand ends an option whose optional value is missing", () => {
  const sub: Subcommand = { name: "sub" };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sub],
  };
  expect(parse(["--color", "sub"], spec).path).toEqual([spec, sub]);
  expect(parse(["--color", "auto", "sub"], spec).options).toEqual(map({ "--color": ["auto"] }));
});

test("parse: a subcommand closes the option before it", () => {
  const sub: Subcommand = { name: "sub", args: { isOptional: true } };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sub],
  };
  const result = parse(["--color", "sub", "value"], spec);
  expect(result.path).toEqual([spec, sub]);
  expect(result.args).toEqual(["value"]);
  expect(result.options).toEqual(map({ "--color": [] }));
});

test("parse: an optional value only gives way to an exact subcommand name", () => {
  const sync: Subcommand = { name: "always-sync" };
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    options: [{ name: "--color", args: { isOptional: true } }],
    subcommands: [sync, { name: "build" }],
  };
  const prefix = parse(["--color", "a"], spec);
  expect(prefix.path).toEqual([spec]);
  expect(prefix.options).toEqual(map({ "--color": ["a"] }));
  const empty = parse(["--color", ""], { ...spec, subcommands: [{ name: "build" }] });
  expect(empty.path).toHaveLength(1);
  expect(empty.options).toEqual(map({ "--color": [""] }));
  expect(parse(["--color", "always-sync"], spec).path).toEqual([spec, sync]);
  expect(parse(["al"], spec).path).toEqual([spec, sync]);
  expect(parse(["--color", "auto", "al"], spec).path).toEqual([spec, sync]);
});

test("parse: distinct long names keep both values when short names clash", () => {
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
    const result = parse(input, spec);
    expect(result.args).toEqual(["file"]);
    expect(result.options.get("--cd")).toEqual(["/repo"]);
    expect(result.options.get("--moved-or-copied")).toEqual([]);
  }
});

test("parse: a repeatable option's count follows its names across commands", () => {
  const verbose: Option = { name: ["-v", "--verbose"], isRepeatable: true };
  const count = (spec: Spec, name: string) =>
    parse(["-v", "-v", "sub", "-v"], spec).options.get(name)?.length;
  const withChild = (option: Option): Spec => ({
    name: "test",
    options: [verbose],
    subcommands: [{ name: "sub", options: [option] }],
  });
  expect(count(withChild(verbose), "-v")).toBe(3);
  expect(count(withChild({ ...verbose }), "-v")).toBe(3);
  const separate = withChild({ name: ["-v", "--inner"], isRepeatable: true });
  expect(count(separate, "--verbose")).toBe(2);
  expect(count(separate, "--inner")).toBe(1);
});

test("parse: a subcommand can reuse a parent option's name", () => {
  const blame: Subcommand = { name: "blame", args: {}, options: [{ name: "-C" }] };
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: {} }],
    subcommands: [blame],
  };
  const result = parse(["-C", "/repo", "blame", "-C", "file"], spec);
  expect(result.path).toEqual([spec, blame]);
  expect(result.args).toEqual(["file"]);
});

test("parse: option values don't count towards optionsMustPrecedeArguments", () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true, isVariadic: true },
    parserDirectives: { optionsMustPrecedeArguments: true },
    options: [{ name: "--a", args: {} }, { name: "--b" }],
  };
  const result = parse(["--a", "1", "--b", "x", "--b"], spec);
  expect(result.options).toEqual(map({ "--a": ["1"], "--b": [] }));
  expect(result.args).toEqual(["x", "--b"]);
});

test("parse: '--' token causes all tokens after it to become args", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--one" }, { name: "--two" }],
    args: [{}, {}],
    subcommands: [{ name: "subcommand", options: [{ name: "--yes" }] }],
  };
  const result1 = parse(["--one", "--", "--two", "--"], spec);
  expect(result1.options).toEqual(map({ "--one": [] }));
  expect(result1.args).toEqual(["--two", "--"]);

  const result2 = parse(["--one", "--", "subcommand", "--yes"], spec);
  expect(result2.options).toEqual(map({ "--one": [] }));
  expect(result2.args).toEqual(["subcommand", "--yes"]);
});

test("parse: '--' fails with too few arguments", () => {
  const spec: Spec = { name: "command", args: [{}, { isOptional: true }] };
  expect(() => parse(["--"], spec)).toThrow();
});

test("parse: '--' fails with too many arguments", () => {
  const spec: Spec = { name: "command", args: [{}, { isOptional: true }] };
  expect(() => parse(["--", "arg", "arg", "arg"], spec)).toThrow();
});

test("parse: '--' cannot be provided after all the arguments", () => {
  expect(() => parse(["arg", "--"], { name: "command", args: {} })).toThrow();
  expect(() => parse(["--"], { name: "command" })).toThrow();
});

test("parse: the last use of a non-repeatable option wins", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--flag" }, { name: ["-c", "--color"], args: {} }],
  };
  expect(parse(["--flag", "--flag"], spec).options).toEqual(map({ "--flag": [] }));
  expect(parse(["--color", "always", "-c", "never"], spec).options).toEqual(
    map({ "-c": ["never"], "--color": ["never"] }),
  );
});

test("parse: repeatable options definitely have one item in the array", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: true }],
  };
  expect(parse(["--rep"], spec).options).toEqual(map({ "--rep": [""], "-r": [""] }));
});

test("parse: infinitely repeatable options work", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: true }],
  };
  expect(parse(["--rep", "--rep", "--rep", "--rep"], spec).options).toEqual(
    map({ "--rep": ["", "", "", ""], "-r": ["", "", "", ""] }),
  );
  expect(parse(["-rrrr"], spec).options).toEqual(map({ "--rep": ["", "", "", ""], "-r": ["", "", "", ""] }));
});

test("parse: finite repeatable options work", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: 2 }],
  };
  expect(parse(["--rep", "--rep"], spec).options).toEqual(map({ "--rep": ["", ""], "-r": ["", ""] }));
  expect(parse(["-rr"], spec).options).toEqual(map({ "--rep": ["", ""], "-r": ["", ""] }));
  expect(() => parse(["--rep", "--rep", "--rep"], spec)).toThrow();
  expect(() => parse(["-rrr"], spec)).toThrow();
});

test("parse: requiresSeparator is true", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: {} }],
    args: { isOptional: true },
  };
  expect(parse(["--sep=val"], spec).options).toEqual(map({ "--sep": ["val"] }));
  expect(() => parse(["--sep", "val"], spec)).toThrow();
});

test("parse: requiresSeparator with optional argument", () => {
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
  const result1 = parse(["--sep=val", "val"], spec);
  expect(result1.options).toEqual(map({ "--sep": ["val"] }));
  expect(result1.args).toEqual(["val"]);

  const result2 = parse(["--sep", "val"], spec);
  expect(result2.options).toEqual(map({ "--sep": [] }));
  expect(result2.args).toEqual(["val"]);
});

test("parse: requiresSeparator with optional argument and following option", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: { isOptional: true } }, { name: "--example" }],
    args: { isOptional: true },
  };
  expect(parse(["--sep", "--example"], spec).options).toEqual(map({ "--sep": [], "--example": [] }));
});

test("parse: requiresSeparator with optional argument and following subcommand", () => {
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
  const result = parse(["--sep", "example"], spec);
  expect(result.options).toEqual(map({ "--sep": [] }));
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
});

test("parse: requiresSeparator with variadic argument", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--sep", requiresSeparator: true, args: { isVariadic: true } }],
    args: { isOptional: true },
  };
  const result = parse(["--sep=val", "val"], spec);
  expect(result.options).toEqual(map({ "--sep": ["val"] }));
  expect(result.args).toEqual(["val"]);
});

test("parse: requiresSeparator is the correct string", () => {
  const spec: Spec = {
    name: "command",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--sep", requiresSeparator: ":", args: {} }],
  };
  expect(parse(["--sep:val"], spec).options).toEqual(map({ "--sep": ["val"] }));
  expect(() => parse(["--sep=val"], spec)).toThrow();
});

test("parse: requiresSeparator option with following subcommand", () => {
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
  expect(() => parse(["--sep", "test"], spec)).toThrow();
});

test("parse: exclusiveOn, unidirectional", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "-a", exclusiveOn: ["-b"] }, { name: "-b" }],
  };
  parse(["-a"], spec);
  parse(["-b"], spec);
  expect(() => parse(["-ab"], spec)).toThrow();
  expect(() => parse(["-a", "-b"], spec)).toThrow();
  expect(() => parse(["-b", "-a"], spec)).toThrow();
});

test("parse: exclusiveOn, bidirectional", () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "-a", exclusiveOn: ["-b"] },
      { name: "-b", exclusiveOn: ["-a"] },
    ],
  };
  parse(["-a"], spec);
  parse(["-b"], spec);
  expect(() => parse(["-ab"], spec)).toThrow();
  expect(() => parse(["-a", "-b"], spec)).toThrow();
  expect(() => parse(["-b", "-a"], spec)).toThrow();
});

test("parse: dependsOn, unidirectional", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "-a", dependsOn: ["-b"] }, { name: "-b" }],
  };
  expect(() => parse(["-a"], spec)).toThrow();
  parse(["-b"], spec);
  parse(["-ab"], spec);
  parse(["-a", "-b"], spec);
  parse(["-b", "-a"], spec);
});

test("parse: dependsOn, bidirectional", () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "-a", dependsOn: ["-b"] },
      { name: "-b", dependsOn: ["-a"] },
    ],
  };
  expect(() => parse(["-a"], spec)).toThrow();
  expect(() => parse(["-b"], spec)).toThrow();
  parse(["-ab"], spec);
  parse(["-a", "-b"], spec);
});

test("parse: requiresSubcommand is equivalent to usage", () => {
  const result = parse([], { name: "command", requiresSubcommand: true });
  expect(result.actions).toEqual([usage]);
});

test("parse: requiresSubcommand doesn't return usage when there is an action", () => {
  const action: Action = () => {};
  const result = parse([], {
    name: "command",
    requiresSubcommand: true,
    action,
  });
  expect(result.actions).toEqual([action]);
});

test("parse: Option.isRequired throws when not provided", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--angry", isRequired: true }],
  };
  expect(() => parse([], spec)).toThrow();
  parse(["--angry"], spec);
});

test("parse: Option.isRequired works when persistent", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--angry", isRequired: true, isPersistent: true }],
    subcommands: [{ name: "cmd" }],
  };
  expect(() => parse(["cmd"], spec)).toThrow();
  parse(["cmd", "--angry"], spec);
});

test("parse: Option.isRequired on subcommands", () => {
  const spec: Spec = {
    name: "command",
    subcommands: [
      {
        name: "cmd",
        options: [{ name: "--angry", isRequired: true, isPersistent: true }],
      },
    ],
  };
  parse([], spec);
  expect(() => parse(["cmd"], spec)).toThrow();
  parse(["cmd", "--angry"], spec);
});

test("parse: hidden options still parse", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--secret", hidden: true, args: {} }],
  };
  expect(parse(["--secret", "value"], spec).options).toEqual(map({ "--secret": ["value"] }));
});

test("parse: hidden subcommands still dispatch", () => {
  const hidden: Subcommand = { name: "hidden", action: () => {} };
  const spec: Spec = { name: "command", subcommands: [hidden] };
  expect(parse(["hidden"], spec).path).toEqual([spec, hidden]);
});

test("parse: option with too few arguments and no separator throws", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--pair", args: [{}, {}] }],
  };
  // End of input before the second argument arrives.
  expect(() => parse(["--pair", "one"], spec)).toThrow(/Option --pair needs 2 arguments/);
});

test("parse: option interrupted by another option throws too few arguments", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--need", args: {} }, { name: "--other" }],
  };
  expect(() => parse(["--need", "--other"], spec)).toThrow(/Option --need needs 1 argument/);
});

test("parse: argument given to a option that takes none throws", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--bare" }],
  };
  // `--bare=oops` is still read as the option plus a value, and the value is
  // rejected.
  expect(() => parse(["--bare=oops"], spec)).toThrow(/Option --bare doesn't take arguments/);
});

test("parse: a single input drives all three parser states", () => {
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
  const result = parse(["--normal", "nval", "--sep=sval", "posarg"], spec);
  expect(result.options).toEqual(map({ "--normal": ["nval"], "--sep": ["sval"] }));
  expect(result.args).toEqual(["posarg"]);
});

test("parse: dependsOn is enforced across a subcommand boundary", () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "--a", isPersistent: true, dependsOn: ["--b"] },
      { name: "--b", isPersistent: true },
    ],
    subcommands: [{ name: "sub" }],
  };
  expect(() => parse(["sub", "--a"], spec)).toThrow();
  parse(["sub", "--a", "--b"], spec);
});

test("parse: exclusiveOn is enforced across a subcommand boundary", () => {
  const spec: Spec = {
    name: "command",
    options: [
      { name: "--a", isPersistent: true, exclusiveOn: ["--b"] },
      { name: "--b", isPersistent: true },
    ],
    subcommands: [{ name: "sub" }],
  };
  parse(["sub", "--a"], spec);
  expect(() => parse(["sub", "--a", "--b"], spec)).toThrow();
});

test("parse: requiresSeparator string rejects the wrong separator on a variadic option", () => {
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
  expect(parse(["--sep:val"], spec).options).toEqual(map({ "--sep": ["val"] }));
  expect(() => parse(["--sep=val"], spec)).toThrow(/Incorrect separator/);
});

test("parse: an unknown option after a requiresSeparator option is reported as unknown", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--tag", args: {}, requiresSeparator: true }],
  };
  expect(() => parse(["--tag", "--nope"], spec)).toThrow(UnknownOption);
});

test("parse: an exact alias wins over prefix matches in prefix mode", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: ["release", "re"] }, { name: "rebuild" }],
  };
  // "re" is a prefix of both commands, but it's also an exact alias of one.
  expect(parse(["re"], spec).path[1]).toBe(spec.subcommands![0]);
  expect(parse(["reb"], spec).path[1]).toBe(spec.subcommands![1]);
  // "r" is an ambiguous prefix, so it's an argument, which this spec rejects.
  expect(() => parse(["r"], spec)).toThrow();
});

test("parse: a parent's required non-persistent option isn't required by its subcommand", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--token", isRequired: true, args: {} }],
    subcommands: [{ name: "sub" }],
  };
  expect(parse(["sub"], spec).path).toEqual([spec, spec.subcommands![0]]);
  // The root command still requires it.
  expect(() => parse([], spec)).toThrow(MissingRequiredOption);
});

test("parse: a subcommand's own required option is still enforced", () => {
  const spec: Spec = {
    name: "test",
    subcommands: [{ name: "sub", options: [{ name: "--name", isRequired: true, args: {} }] }],
  };
  expect(() => parse(["sub"], spec)).toThrow(MissingRequiredOption);
  expect(parse(["sub", "--name", "x"], spec).options).toEqual(map({ "--name": ["x"] }));
});

test("parse: a long option splits at the first separator in the token", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--define", args: {} }],
  };
  expect(parse(["--define=k:v"], spec).options).toEqual(map({ "--define": ["k:v"] }));
  expect(parse(["--define:k=v"], spec).options).toEqual(map({ "--define": ["k=v"] }));
});

test("parse: the longer of two separators that start at the same place wins", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ["=", "=="] },
    options: [{ name: "--define", args: {} }],
  };
  expect(parse(["--define==v"], spec).options).toEqual(map({ "--define": ["v"] }));
  expect(parse(["--define=v==w"], spec).options).toEqual(map({ "--define": ["v==w"] }));
});

test("parse: a repeatable option with an argument collects a value from each use", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-I", "--include"], isRepeatable: true, args: {} }],
  };
  expect(parse(["-I", "a"], spec).options.get("-I")).toEqual(["a"]);
  expect(parse(["-Ia"], spec).options.get("-I")).toEqual(["a"]);
  expect(parse(["-I", "a", "-Ib", "--include=c"], spec).options).toEqual(
    map({ "-I": ["a", "b", "c"], "--include": ["a", "b", "c"] }),
  );
});

test("parse: a repeatable option with an argument still limits its uses", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-I", isRepeatable: 2, args: {} }],
  };
  expect(parse(["-I", "a", "-I", "b"], spec).options.get("-I")).toEqual(["a", "b"]);
  expect(() => parse(["-I", "a", "-I", "b", "-I", "c"], spec)).toThrow("Too many repetitions");
});

test("parse: a repeatable option with a required argument rejects a missing value", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-I", isRepeatable: true, args: {} }],
  };
  expect(() => parse(["-I"], spec)).toThrow(TooFewOptionArguments);
});

test("parse: an empty argument doesn't prefix-match a subcommand", () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "build" }],
  };
  const result = parse([""], spec);
  expect(result.path).toEqual([spec]);
  expect(result.args).toEqual([""]);
});

test("parse: a subcommand can turn off optionsMustPrecedeArguments", () => {
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
  const result = parse(["sub", "a", "-v"], spec);
  expect(result.args).toEqual(["a"]);
  expect(result.options).toEqual(map({ "-v": [] }));
});

test("parse: a subcommand can turn off subcommandsMatchUniquePrefix", () => {
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
  const result = parse(["sub", "bu"], spec);
  expect(result.path).toEqual([spec, spec.subcommands![0]]);
  expect(result.args).toEqual(["bu"]);
});

test("parse: a dependsOn error joins the option's aliases with a slash", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-a", "--all"], dependsOn: ["-b"] }, { name: "-b" }],
  };
  expect(() => parse(["--all"], spec)).toThrow("-a/--all requires -b");
});

test("parse: an exclusiveOn error joins the option's aliases with a slash", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: ["-a", "--all"], exclusiveOn: ["-b"] }, { name: "-b" }],
  };
  expect(() => parse(["--all", "-b"], spec)).toThrow("-a/--all can't be used together with -b");
});

/** Run `fn`, which must throw, and return what it threw. */
function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("Expected a throw");
}

test("parse: an unknown option in a chain names its character", () => {
  const spec: Spec = { name: "test", args: { isOptional: true }, options: [{ name: "-v" }] };
  const error = thrown(() => parse(["x", "-vx"], spec));
  expect(error).toBeInstanceOf(UnknownOption);
  expect(error).toMatchObject({ option: "-x" });
});

test("parse: an unknown long option's name leaves out its attached value", () => {
  const spec: Spec = { name: "test", args: { isOptional: true }, options: [{ name: "--known" }] };
  const error = thrown(() => parse(["a", "--nope=1"], spec));
  expect(error).toBeInstanceOf(UnknownOption);
  expect(error).toMatchObject({ option: "--nope" });
  expect((error as Error).message).toBe('"--nope" looks like a flag, but is unknown in this context');
});

test("parse: a value attached to an option without args names the option", () => {
  const spec: Spec = { name: "test", options: [{ name: ["-v", "--verbose"] }] };
  const error = thrown(() => parse(["--verbose=1"], spec));
  expect(error).toBeInstanceOf(InvalidOptionArg);
  expect((error as Error).message).toBe("Option --verbose doesn't take arguments");
});

test("parse: too many arguments names the first extra one, including after '--'", () => {
  const spec: Spec = { name: "test", args: {} };
  const error = thrown(() => parse(["--", "a", "b"], spec));
  expect(error).toBeInstanceOf(TooManyArguments);
  expect((error as Error).message).toBe('Too many arguments, "b" was unexpected');
});

test("parse: an unknown option lists the valid names and the command it was found in", () => {
  const sub: Subcommand = {
    name: "sub",
    options: [{ name: "--x" }, { name: "--g", isPersistent: true }],
  };
  const spec: Spec = {
    name: "test",
    options: [{ name: "--g", isPersistent: true }, { name: "--local" }, { name: "--g2", isPersistent: true }],
    subcommands: [sub],
  };
  const error = thrown(() => parse(["sub", "--nope"], spec));
  expect(error).toBeInstanceOf(UnknownOption);
  // Local names first, then persistent ones, each listed once, in the order
  // the options they refer to are defined. The parent's non-persistent option
  // isn't valid in the subcommand, and its `--g` is shadowed by the
  // subcommand's.
  expect((error as UnknownOption).didYouMean?.choices).toEqual([["--x"], ["--g2"], ["--g"]]);
  expect((error as UnknownOption).context.path).toEqual([spec, sub]);
});

test("parse: an unknown option doesn't suggest hidden options", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--secret-mode", hidden: true }, { name: "--verbose" }],
  };
  const error = thrown(() => parse(["--secret-mod"], spec));
  expect((error as UnknownOption).didYouMean?.choices).toEqual([["--verbose"]]);
});

test("parse: missing argument messages describe the expected count", () => {
  const message = (args: Spec["args"], input: string[]) => {
    const error = thrown(() => parse(input, { name: "test", args }));
    expect(error).toBeInstanceOf(TooFewArguments);
    return (error as Error).message;
  };
  expect(message({}, [])).toBe("Expected 1 argument");
  expect(message([{}, {}], ["a"])).toBe("Expected 2 arguments");
  expect(message([{}, { isOptional: true }], [])).toBe("Expected between 1 and 2 arguments");
  expect(message([{}, {}, { isVariadic: true, isOptional: true }], [])).toBe("Expected at least 2 arguments");
});

test("parse: missing option value messages describe the expected count", () => {
  const message = (args: Option["args"]) => {
    const error = thrown(() => parse(["--o", "a"], { name: "test", options: [{ name: "--o", args }] }));
    expect(error).toBeInstanceOf(TooFewOptionArguments);
    return (error as Error).message;
  };
  expect(message([{}, {}])).toBe("Option --o needs 2 arguments");
  expect(message([{}, {}, { isOptional: true }])).toBe("Option --o needs between 2 and 3 arguments");
  expect(message([{}, {}, { isVariadic: true, isOptional: true }])).toBe(
    "Option --o needs at least 2 arguments",
  );
});

test("parse: '--' with no room for arguments explains itself", () => {
  expect(() => parse(["--"], { name: "test" })).toThrow(
    "Unexpected argument '--', did you mean to use an option instead?",
  );
});

test("parse: a subcommand inherits option arg separators", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--g", args: {}, isPersistent: true }],
    subcommands: [{ name: "sub" }],
  };
  expect(parse(["sub", "--g:1"], spec).options).toEqual(map({ "--g": ["1"] }));
  expect(() => parse(["sub", "--g=1"], spec)).toThrow(UnknownOption);
});

test("parse: a subcommand's separators apply to inherited options", () => {
  const sub: Subcommand = { name: "sub", parserDirectives: { optionArgSeparators: "=" } };
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: ":" },
    options: [{ name: "--g", args: {}, isPersistent: true }],
    subcommands: [sub],
  };
  expect(parse(["sub", "--g=1"], spec).options).toEqual(map({ "--g": ["1"] }));
  expect(() => parse(["sub", "--g:1"], spec)).toThrow(UnknownOption);
  // Before the subcommand, the parent's separators are still in effect.
  const before = parse(["--g:1", "sub"], spec);
  expect(before.path).toEqual([spec, sub]);
  expect(before.options).toEqual(map({ "--g": ["1"] }));
});

test("parse: an empty list of separators turns off attached values", () => {
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
  expect(() => parse(["sub", "--g=1"], spec)).toThrow(UnknownOption);
  expect(parse(["sub", "--g", "1"], spec).options).toEqual(map({ "--g": ["1"] }));
  // A short option's value starts right after its name.
  expect(parse(["sub", "-o=1"], spec).options).toEqual(map({ "-o": ["=1"] }));
});

test("parse: a subcommand can turn off flagsArePosixNoncompliant", () => {
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
  expect(parse(["--x"], spec).args).toEqual(["--x"]);
  expect(() => parse(["sub", "--x"], spec)).toThrow(UnknownOption);
  expect(parse(["sub", "-ab"], spec).options).toEqual(map({ "-a": [], "-b": [] }));
});

test("parse: a POSIX-noncompliant option takes an attached value", () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "out", args: {} }, { name: "flag" }],
  };
  const result = parse(["out=x", "y"], spec);
  expect(result.options).toEqual(map({ out: ["x"] }));
  expect(result.args).toEqual(["y"]);
  const error = thrown(() => parse(["flag=x"], spec));
  expect(error).toBeInstanceOf(InvalidOptionArg);
  expect(error).toMatchObject({ option: "flag" });
});

test("parse: a short option's attached value can follow any configured separator", () => {
  const spec: Spec = {
    name: "test",
    parserDirectives: { optionArgSeparators: [":", "="] },
    options: [{ name: "-o", args: {} }],
  };
  expect(parse(["-o:1"], spec).options).toEqual(map({ "-o": ["1"] }));
  expect(parse(["-o=1"], spec).options).toEqual(map({ "-o": ["1"] }));
  expect(parse(["-o1"], spec).options).toEqual(map({ "-o": ["1"] }));
});

test("parse: a '+' option takes an attached value after a separator", () => {
  const spec: Spec = { name: "test", options: [{ name: "+o", args: {} }] };
  expect(parse(["+o=1"], spec).options).toEqual(map({ "+o": ["1"] }));
});

test("parse: an optional value in the middle of a chain takes the rest of the token", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-a" }, { name: "-b", args: { isOptional: true } }, { name: "-c" }],
  };
  expect(parse(["-abc"], spec).options).toEqual(map({ "-a": [], "-b": ["c"] }));
});

test("parse: an option waiting for a value takes unknown option-like tokens", () => {
  const spec: Spec = { name: "test", options: [{ name: "-o", args: {} }, { name: "-v" }] };
  expect(parse(["-o", "-5"], spec).options).toEqual(map({ "-o": ["-5"] }));
  expect(parse(["-o", "--x"], spec).options).toEqual(map({ "-o": ["--x"] }));
  expect(() => parse(["-o", "-v"], spec)).toThrow(TooFewOptionArguments);
  expect(() => parse(["-o", "--"], spec)).toThrow(TooFewOptionArguments);
});

test("parse: requiresSeparator string rejects a short option's unseparated value", () => {
  const spec: Spec = { name: "test", options: [{ name: "-q", args: {}, requiresSeparator: "=" }] };
  expect(parse(["-q=val"], spec).options).toEqual(map({ "-q": ["val"] }));
  expect(() => parse(["-qval"], spec)).toThrow(/Incorrect separator, use '='/);
});

test("parse: a repeatable persistent option with an argument shares its uses with subcommands", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--tag", args: {}, isRepeatable: 2, isPersistent: true }],
    subcommands: [{ name: "sub" }],
  };
  expect(parse(["--tag", "a", "sub", "--tag", "b"], spec).options).toEqual(map({ "--tag": ["a", "b"] }));
  expect(() => parse(["--tag", "a", "sub", "--tag", "b", "--tag", "c"], spec)).toThrow(
    "Too many repetitions",
  );
});

test("parse: a repeatable option with a variadic argument collects every use's values", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--p", args: { isVariadic: true }, isRepeatable: true }],
  };
  expect(parse(["--p", "a", "b", "--p", "c"], spec).options).toEqual(map({ "--p": ["a", "b", "c"] }));
});

test("parse: each use of a repeatable option needs its own arguments", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--p", args: [{}, {}], isRepeatable: true }],
  };
  expect(parse(["--p", "a", "b", "--p", "c", "d"], spec).options).toEqual(
    map({ "--p": ["a", "b", "c", "d"] }),
  );
  expect(() => parse(["--p", "a", "b", "--p", "c"], spec)).toThrow("Option --p needs 2 arguments");
});

test("parse: a variadic option value takes a subcommand's name", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--files", args: { isVariadic: true } },
      { name: "--maybe", args: { isVariadic: true, isOptional: true } },
    ],
    subcommands: [{ name: "build" }],
  };
  const required = parse(["--files", "a", "build"], spec);
  expect(required.path).toEqual([spec]);
  expect(required.options).toEqual(map({ "--files": ["a", "build"] }));
  const optional = parse(["--maybe", "build"], spec);
  expect(optional.path).toEqual([spec]);
  expect(optional.options).toEqual(map({ "--maybe": ["build"] }));
});

test("parse: a command that requires a subcommand reports a stray argument as an unknown command", () => {
  const spec: Spec = { name: "test", requiresSubcommand: true, subcommands: [{ name: "add" }] };
  const error = thrown(() => parse(["ad", "extra"], spec));
  expect(error).toBeInstanceOf(ParseError);
  expect((error as ParseError).message).toBe("Unknown command 'ad'");
  expect((error as ParseError).didYouMean).toEqual({ input: "ad", choices: [["add"]] });
  expect(() => parse([""], spec)).toThrow("Expected a command, but the value was empty");
  // Its own action doesn't take the stray arguments either.
  expect(() => parse(["ad"], { ...spec, action: () => {} })).toThrow("Unknown command 'ad'");
});

test("parse: an ambiguous prefix is reported with the commands it could be", () => {
  const spec: Spec = {
    name: "test",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [{ name: "status" }, { name: ["stash", "st"] }, { name: "store", hidden: true }],
  };
  expect(() => parse(["sta"], spec)).toThrow("Ambiguous command 'sta', could be: status, stash");
});

test("parse: a command without room for arguments reports a mistyped subcommand", () => {
  const spec: Spec = { name: "test", action: () => {}, subcommands: [{ name: "build" }] };
  const error = thrown(() => parse(["biuld"], spec));
  expect((error as ParseError).message).toBe("Unknown command 'biuld'");
  expect((error as ParseError).didYouMean?.choices).toEqual([["build"]]);
  // Once an argument is found, a later one is just too many.
  const withArg: Spec = { ...spec, args: {} };
  expect(() => parse(["a", "b"], withArg)).toThrow(TooManyArguments);
  // An option action still runs.
  const withHelp: Spec = { ...spec, options: [{ name: "--help", action: () => {} }] };
  expect(parse(["biuld", "--help"], withHelp).optionActions).toHaveLength(1);
});

test("parse: an option action skips required arguments and options", () => {
  const spec: Spec = {
    name: "test",
    args: {},
    options: [
      { name: "--help", action: () => {} },
      { name: "--r", isRequired: true },
    ],
  };
  const result = parse(["--help"], spec);
  expect(result.args).toEqual([]);
  expect(result.optionActions).toHaveLength(1);
});

test("parse: a value attached to a short option without args says it takes none", () => {
  const spec: Spec = { name: "test", options: [{ name: ["-v", "--verbose"] }] };
  const error = thrown(() => parse(["-v=1"], spec));
  expect(error).toBeInstanceOf(InvalidOptionArg);
  expect(error).toMatchObject({ option: "-v" });
  // An option named like the separator still chains.
  const chained: Spec = { name: "test", options: [{ name: "-v" }, { name: "-=" }] };
  expect(parse(["-v="], chained).options).toEqual(map({ "-v": [], "-=": [] }));
});

test("parse: requiresSeparator true rejects a short option's unseparated value", () => {
  const spec: Spec = { name: "test", options: [{ name: "-o", args: {}, requiresSeparator: true }] };
  expect(parse(["-o=val"], spec).options).toEqual(map({ "-o": ["val"] }));
  expect(() => parse(["-oval"], spec)).toThrow("Missing separator, use '=' between -o and its value");
});

test("parse: an option action skips argument count and option relationship checks", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--help", action: () => {} },
      { name: "--a", dependsOn: ["--b"] },
      { name: "--b" },
      { name: "--c", exclusiveOn: ["--b"] },
    ],
  };
  expect(parse(["a", "b", "--help"], spec).optionActions).toHaveLength(1);
  expect(parse(["--help", "--a"], spec).optionActions).toHaveLength(1);
  expect(parse(["--help", "--b", "--c"], spec).optionActions).toHaveLength(1);
  // Without the action, each of these is still an error.
  expect(() => parse(["a"], spec)).toThrow(TooManyArguments);
  expect(() => parse(["--a"], spec)).toThrow("--a requires --b");
  expect(() => parse(["--b", "--c"], spec)).toThrow("--c can't be used together with --b");
});

test("parse: a command that shows usage for a missing subcommand skips required options", () => {
  const spec: Spec = {
    name: "test",
    requiresSubcommand: true,
    options: [{ name: "--token", isPersistent: true, isRequired: true }],
    subcommands: [{ name: "a" }],
  };
  expect(parse([], spec).actions).toEqual([usage]);
  expect(() => parse(["a"], spec)).toThrow(MissingRequiredOption);
});

test("parse: a command that requires a subcommand accepts '--' alone, but no argument after it", () => {
  const spec: Spec = { name: "test", requiresSubcommand: true, subcommands: [{ name: "a" }] };
  const result = parse(["--"], spec);
  expect(result.actions).toEqual([usage]);
  expect(result.argSeparatorIndex).toBe(0);
  expect(() => parse(["--", "a"], spec)).toThrow('Too many arguments, "a" was unexpected');
  const action: Action = () => {};
  expect(parse(["--"], { ...spec, action }).actions).toEqual([action]);
});

test("parse: '--' after an argument is an argument when options must precede arguments", () => {
  const spec: Spec = {
    name: "test",
    args: { isVariadic: true },
    parserDirectives: { optionsMustPrecedeArguments: true },
  };
  const result = parse(["a", "--", "b"], spec);
  expect(result.args).toEqual(["a", "--", "b"]);
  expect(result.argSeparatorIndex).toBe(-1);
  // Before any argument, it still ends the options.
  expect(parse(["--", "-x"], spec).argSeparatorIndex).toBe(0);
});

test("parse: an attached value is the option's only value", () => {
  const spec: Spec = {
    name: "test",
    args: { isOptional: true },
    options: [
      { name: "--two", args: [{}, {}] },
      { name: "--many", args: { isVariadic: true } },
      { name: "-m", args: { isVariadic: true } },
    ],
  };
  expect(() => parse(["--two=a", "b"], spec)).toThrow("Option --two needs 2 arguments");
  for (const input of [
    ["--many=a", "b"],
    ["-ma", "b"],
  ]) {
    const result = parse(input, spec);
    expect([...result.options.values()]).toEqual([["a"]]);
    expect(result.args).toEqual(["b"]);
  }
});
