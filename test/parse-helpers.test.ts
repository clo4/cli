import { describe, expect, test } from "vitest";

import { matchSubcommand, prefixMatches } from "../src/subcommands.js";
import type { Subcommand } from "../src/types.js";

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

test("prefixMatches lists each visible command once, and nothing for an empty token", () => {
  const build: Subcommand = { name: ["build", "bu-build"] };
  const bundle: Subcommand = { name: "bundle" };
  const secret: Subcommand = { name: "bunker", hidden: true };
  expect(prefixMatches([build, bundle, secret], "bu")).toEqual([build, bundle]);
  expect(prefixMatches([build, bundle, secret], "bun")).toEqual([bundle]);
  expect(prefixMatches([build, bundle, secret], "")).toEqual([]);
});
