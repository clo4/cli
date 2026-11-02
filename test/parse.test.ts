import { expect, test } from "vitest";

import { usage } from "../src/help.js";
import { getMaxArgs, getMinArgs, parse } from "../src/parse.js";
import type { Action, Spec, Subcommand } from "../src/types.js";
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

test("parse: non-persistent options prevent subcommands from being used", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--not-persistent" }],
    subcommands: [{ name: "subcommand" }],
  };
  expect(() => parse(["--not-persistent", "subcommand"], spec)).toThrow();
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

test("parse: non-repeatable options cannot be repeated", () => {
  const spec: Spec = { name: "command", options: [{ name: "--normal" }] };
  expect(() => parse(["--normal", "--normal"], spec)).toThrow();
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
  expect(parse(["-rrrr"], spec).options).toEqual(
    map({ "--rep": ["", "", "", ""], "-r": ["", "", "", ""] }),
  );
});

test("parse: finite repeatable options work", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: ["-r", "--rep"], isRepeatable: 2 }],
  };
  expect(parse(["--rep", "--rep"], spec).options).toEqual(
    map({ "--rep": ["", ""], "-r": ["", ""] }),
  );
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
    options: [
      { name: "--sep", requiresSeparator: true, args: { isOptional: true } },
      { name: "--example" },
    ],
    args: { isOptional: true },
  };
  expect(parse(["--sep", "--example"], spec).options).toEqual(
    map({ "--sep": [], "--example": [] }),
  );
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
  expect(() => parse(["--pair", "one"], spec)).toThrow(/Option needs 2 arguments/);
});

test("parse: option interrupted by another option throws too few arguments", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--need", args: {} }, { name: "--other" }],
  };
  expect(() => parse(["--need", "--other"], spec)).toThrow(/Option needs 1 argument/);
});

test("parse: argument given to a option that takes none throws", () => {
  const spec: Spec = {
    name: "command",
    options: [{ name: "--bare" }],
  };
  // `analyze` still splits `--bare=oops` into a option + option-arg; the parser
  // rejects the stray argument.
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
