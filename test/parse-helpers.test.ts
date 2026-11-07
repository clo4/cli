import { describe, expect, test } from "vitest";

import { MissingRequiredOption, ParseError } from "../src/errors.js";
import { checkOptionRules, firstSeparator, leadingSeparator } from "../src/parse.js";
import { matchSubcommand, prefixMatches } from "../src/subcommands.js";
import type { Option, Spec, Subcommand } from "../src/types.js";

describe("matchSubcommand", () => {
  const build: Subcommand = { name: ["build", "b"] };
  const bundle: Subcommand = { name: "bundle" };
  const remote: Subcommand = { name: "remote" };
  const subcommands = [build, bundle, remote];

  test.each([
    { token: "build", allowPrefix: false, expected: build, why: "exact name" },
    { token: "b", allowPrefix: false, expected: build, why: "exact alias" },
    { token: "b", allowPrefix: true, expected: build, why: "exact alias beats prefix of others" },
    { token: "rem", allowPrefix: false, expected: null, why: "prefix without allowPrefix" },
    { token: "rem", allowPrefix: true, expected: remote, why: "unique prefix" },
    { token: "bu", allowPrefix: true, expected: null, why: "ambiguous prefix" },
    { token: "bui", allowPrefix: true, expected: build, why: "unique prefix of a name in a list" },
    { token: "", allowPrefix: true, expected: null, why: "empty token never prefix-matches" },
    { token: "x", allowPrefix: true, expected: null, why: "no match" },
  ])("$why: $token", ({ token, allowPrefix, expected }) => {
    expect(matchSubcommand(subcommands, token, allowPrefix)).toBe(expected);
  });

  test("a command whose names share a prefix counts once", () => {
    const status: Subcommand = { name: ["status", "stat"] };
    expect(matchSubcommand([status, remote], "sta", true)).toBe(status);
  });

  test("a hidden command only matches its exact name", () => {
    const bundle: Subcommand = { name: "bundle", hidden: true };
    expect(matchSubcommand([build, bundle], "bu", true)).toBe(build);
    expect(matchSubcommand([build, bundle], "bun", true)).toBeNull();
    expect(matchSubcommand([build, bundle], "bundle", true)).toBe(bundle);
  });

  test("an empty name matches an empty token exactly", () => {
    const empty: Subcommand = { name: "" };
    expect(matchSubcommand([remote, empty], "", true)).toBe(empty);
  });
});

describe("leadingSeparator", () => {
  test.each([
    { text: "=value", separators: ["="], expected: "=" },
    { text: "value", separators: ["="], expected: "" },
    { text: ":=value", separators: [":", ":="], expected: ":" },
    { text: ":=value", separators: [":=", ":"], expected: ":=" },
    { text: "=value", separators: [], expected: "" },
  ])("$text with $separators", ({ text, separators, expected }) => {
    expect(leadingSeparator(text, separators)).toBe(expected);
  });
});

describe("firstSeparator", () => {
  test.each([
    { token: "--out=dir", separators: ["="], expected: { index: 5, sep: "=" } },
    { token: "--out", separators: ["="], expected: null },
    { token: "--out:a=b", separators: ["=", ":"], expected: { index: 5, sep: ":" } },
    { token: "--out==x", separators: ["=", "=="], expected: { index: 5, sep: "==" } },
    { token: "--out=x", separators: [], expected: null },
    { token: "--out=x", separators: [""], expected: null },
  ])("$token with $separators", ({ token, separators, expected }) => {
    expect(firstSeparator(token, separators)).toEqual(expected);
  });
});

describe("checkOptionRules", () => {
  const context = { path: [{ name: "test" } as Spec] as const };
  const out: Option = { name: "--out", args: {} };
  const verbose: Option = { name: ["-v", "--verbose"], dependsOn: ["--out"] };
  const quiet: Option = { name: "-q", exclusiveOn: ["-v"] };

  const used = (...pairs: [string[], Option][]) => {
    const options = new Map<string, string[]>();
    for (const [names] of pairs) for (const name of names) options.set(name, []);
    return { options, seen: pairs.map(([, option]) => option) };
  };

  test("passes when every rule holds", () => {
    const { options, seen } = used([["--out"], out], [["-v", "--verbose"], verbose]);
    expect(() => checkOptionRules(options, seen, [out], context)).not.toThrow();
  });

  test("dependsOn", () => {
    const { options, seen } = used([["-v", "--verbose"], verbose]);
    expect(() => checkOptionRules(options, seen, [], context)).toThrow(
      new ParseError(context, "-v/--verbose requires --out, add it to fix this error"),
    );
  });

  test("exclusiveOn", () => {
    const { options, seen } = used([["--out"], out], [["-v", "--verbose"], verbose], [["-q"], quiet]);
    expect(() => checkOptionRules(options, seen, [], context)).toThrow(
      new ParseError(context, "-q can't be used together with -v"),
    );
  });

  test("required", () => {
    const { options, seen } = used();
    expect(() => checkOptionRules(options, seen, [out], context)).toThrow(MissingRequiredOption);
  });

  test("dependsOn is checked before required", () => {
    const { options, seen } = used([["-v", "--verbose"], verbose]);
    expect(() => checkOptionRules(options, seen, [quiet], context)).toThrow(/requires --out/);
  });
});

test("prefixMatches lists each visible command once, and nothing for an empty token", () => {
  const build: Subcommand = { name: ["build", "bu-build"] };
  const bundle: Subcommand = { name: "bundle" };
  const secret: Subcommand = { name: "bunker", hidden: true };
  expect(prefixMatches([build, bundle, secret], "bu")).toEqual([build, bundle]);
  expect(prefixMatches([build, bundle, secret], "bun")).toEqual([bundle]);
  expect(prefixMatches([build, bundle, secret], "")).toEqual([]);
});
