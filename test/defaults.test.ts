import { expect, test } from "vitest";

import { getHelp } from "../src/help.js";
import { run } from "../src/index.js";
import { parse } from "../src/parse.js";
import { assertDefaultsCanBeUsed, assertDescriptionLineLengthUnder69 } from "../src/testing.js";
import type { ActionInit, Spec } from "../src/types.js";
import { captureConsole, expectIncludes, map } from "./helpers.js";

async function actionInit(spec: Spec, argv: string[]): Promise<ActionInit> {
  let init: ActionInit | undefined;
  const code = await run({ ...spec, action: (i) => void (init = i) }, argv);
  expect(code).toBe(0);
  return init!;
}

test("defaults: a missing positional argument gets its default", () => {
  const spec: Spec = {
    name: "serve",
    args: [{ name: "dir" }, { name: "port", isOptional: true, default: "8080" }],
  };
  expect(parse(["site"], spec).args).toEqual(["site", "8080"]);
  expect(parse(["site", "3000"], spec).args).toEqual(["site", "3000"]);
});

test("defaults: filling stops at the first missing argument without a default", () => {
  const spec: Spec = {
    name: "test",
    args: [
      { name: "a", isOptional: true, default: "A" },
      { name: "b", isOptional: true },
      { name: "c", isOptional: true, default: "C" },
    ],
  };
  expect(parse([], spec).args).toEqual(["A"]);
  expect(parse(["x"], spec).args).toEqual(["x"]);
  expect(parse(["x", "y"], spec).args).toEqual(["x", "y", "C"]);
});

test("defaults: a variadic argument's default is one value", () => {
  const spec: Spec = {
    name: "test",
    args: { name: "files", isOptional: true, isVariadic: true, default: "." },
  };
  expect(parse([], spec).args).toEqual(["."]);
  expect(parse(["a", "b"], spec).args).toEqual(["a", "b"]);
});

test("defaults: an option action with a required argument missing doesn't get a default in its place", () => {
  const spec: Spec = {
    name: "test",
    args: [{ name: "dir" }, { name: "port", isOptional: true, default: "8080" }],
    options: [{ name: "--version", action: () => {} }],
  };
  expect(parse(["--version"], spec).args).toEqual([]);
});

test("defaults: a default is added after the `--` separator", () => {
  const spec: Spec = { name: "test", args: { name: "dir", isOptional: true, default: "." } };
  const result = parse(["--"], spec);
  expect(result.args).toEqual(["."]);
  expect(result.argSeparatorIndex).toBe(0);
});

test("defaults: a bare option gets the defaults of its optional arguments", () => {
  const spec: Spec = {
    name: "node",
    options: [
      {
        name: "--inspect",
        requiresSeparator: true,
        args: { name: "port", isOptional: true, default: "9229" },
      },
      {
        name: "--size",
        args: [
          { name: "w", default: "80" },
          { name: "h", isOptional: true, default: "24" },
        ],
      },
    ],
  };
  expect(parse(["--inspect"], spec).options).toEqual(map({ "--inspect": ["9229"] }));
  expect(parse(["--inspect=4000"], spec).options).toEqual(map({ "--inspect": ["4000"] }));
  expect(parse(["--size", "100"], spec).options).toEqual(map({ "--size": ["100", "24"] }));
  expect(parse(["--size", "100", "50"], spec).options).toEqual(map({ "--size": ["100", "50"] }));
});

test("defaults: an option whose first argument is optional gets nothing when it's left out", async () => {
  const spec: Spec = {
    name: "node",
    options: [{ name: "--inspect", args: { name: "port", isOptional: true, default: "9229" } }],
  };
  expect(parse([], spec).defaults("--inspect")).toBeUndefined();
  const absent = (await actionInit(spec, [])).options;
  expect([absent.has("--inspect"), absent.get("--inspect")]).toEqual([false, undefined]);
  const bare = (await actionInit(spec, ["--inspect"])).options;
  expect([bare.has("--inspect"), bare.get("--inspect"), bare.count("--inspect")]).toEqual([true, "9229", 1]);
});

test("defaults: a left-out option with a required argument gets its optional arguments' defaults too", () => {
  const spec: Spec = {
    name: "test",
    options: [
      {
        name: "--size",
        args: [
          { name: "w", default: "80" },
          { name: "h", isOptional: true, default: "24" },
        ],
      },
    ],
  };
  expect(parse([], spec).defaults("--size")).toEqual(["80", "24"]);
});

test("defaults: each use of a repeatable option gets the default", () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "-l", isRepeatable: true, args: { name: "level", isOptional: true, default: "1" } }],
  };
  expect(parse(["-l", "-l", "3", "-l"], spec).options).toEqual(map({ "-l": ["1", "3", "1"] }));
});

test("defaults: an option that isn't used has its defaults looked up by name", () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: ["-p", "--port"], args: { name: "port", default: "8080" } },
      { name: "--host", args: { name: "host" } },
    ],
  };
  const result = parse([], spec);
  expect(result.options).toEqual(map({}));
  expect(result.defaults("-p")).toEqual(["8080"]);
  expect(result.defaults("--port")).toEqual(["8080"]);
  expect(result.defaults("--host")).toBeUndefined();
  expect(result.defaults("--nope")).toBeUndefined();
  expect(parse(["--port", "1"], spec).defaults("-p")).toBeUndefined();
});

test("defaults: get and all fall back to defaults, has and count don't", async () => {
  const spec: Spec = {
    name: "test",
    options: [{ name: "--port", args: { name: "port", default: "8080" } }],
  };
  const { options } = await actionInit(spec, []);
  expect(options.get("--port")).toBe("8080");
  expect(options.all("--port")).toEqual(["8080"]);
  expect(options.has("--port")).toBe(false);
  expect(options.count("--port")).toBe(0);
  expect(options.options.has("--port")).toBe(false);
});

test("defaults: a default doesn't satisfy or break option rules", async () => {
  const spec: Spec = {
    name: "test",
    options: [
      { name: "--port", args: { name: "port", default: "8080" } },
      { name: "--tls", dependsOn: ["--port"] },
      { name: "--socket", exclusiveOn: ["--port"] },
    ],
  };
  expect(() => parse(["--tls"], spec)).toThrow("--tls requires --port");
  expect(() => parse(["--socket"], spec)).not.toThrow();
  const result = await captureConsole(() => run({ ...spec, action: () => {} }, ["--tls"]));
  expect(result.code).toBe(1);
});

test("defaults: help shows an option's defaults after its description", () => {
  const spec: Spec = {
    name: "serve",
    args: { name: "dir", isOptional: true, default: "." },
    options: [
      { name: "--port", description: "Port to listen on", args: { name: "port", default: "8080" } },
      {
        name: "--size",
        args: [
          { name: "w", default: "80" },
          { name: "h", default: "24" },
        ],
      },
    ],
  };
  const help = getHelp([spec]);
  expectIncludes(help, "serve [flags] [dir]\n\nArguments:\n  dir  (default: .)\n\nFlags:\n");
  expectIncludes(help, "--port <port>   Port to listen on (default: 8080)");
  expectIncludes(help, "--size <w> <h>  (default: 80 24)");
});

test("defaults: help puts the defaults on their own line when the last line is too long", () => {
  const long = "Where the server writes its access log, rotated every night at 12";
  expect(long.length).toBe(65);
  const spec: Spec = {
    name: "serve",
    options: [
      { name: "--log", description: long, args: { name: "file", default: "access.log" } },
      {
        name: "--port",
        description: "Short line\nPort to listen on",
        args: { name: "port", default: "8080" },
      },
    ],
  };
  const help = getHelp([spec]);
  expectIncludes(help, `--log <file>   ${long}\n                 (default: access.log)\n`);
  expectIncludes(help, "  --port <port>  Short line\n                 Port to listen on (default: 8080)\n");
});

test("help lists positional arguments when one has a description or default", () => {
  const spec: Spec = {
    name: "serve",
    args: [
      { name: "dir", description: "Folder to serve", isOptional: true, default: "." },
      { name: "files", isOptional: true, isVariadic: true },
    ],
    options: [{ name: "--port", description: "Port to listen on", args: { name: "port", default: "8080" } }],
  };
  expect(getHelp([spec])).toBe(
    [
      "Usage:",
      "  serve [flags] [dir] [files]...",
      "",
      "Arguments:",
      "  dir       Folder to serve (default: .)",
      "  files...",
      "",
      "Flags:",
      "  --port <port>  Port to listen on (default: 8080)",
      "",
    ].join("\n"),
  );
});

test("help leaves out the Arguments section when there's nothing to add to usage", () => {
  const plain: Spec = { name: "serve", args: [{ name: "dir" }, { name: "rest", isOptional: true }] };
  expect(getHelp([plain])).not.toContain("Arguments:");
  const grouping: Spec = {
    name: "serve",
    requiresSubcommand: true,
    args: { name: "dir", description: "Never used" },
    subcommands: [{ name: "start", description: "Start" }],
  };
  expect(getHelp([grouping])).not.toContain("Arguments:");
});

test("assertDescriptionLineLengthUnder69 checks positional argument descriptions", () => {
  const spec = (description: string): Spec => ({ name: "serve", args: { name: "dir", description } });
  assertDescriptionLineLengthUnder69(spec("x".repeat(68)));
  expect(() => assertDescriptionLineLengthUnder69(spec("x".repeat(69)))).toThrow(
    "argument dir has a description line over 68 characters",
  );
});

test("defaults: assertDefaultsCanBeUsed", () => {
  assertDefaultsCanBeUsed({ name: "test", args: [{}, { isOptional: true, default: "x" }] });
  assertDefaultsCanBeUsed({
    name: "test",
    args: [{ isOptional: true, default: "x" }, { isOptional: true }],
  });
  assertDefaultsCanBeUsed({
    name: "test",
    args: [{ isOptional: true }, { isOptional: true, default: "x" }],
  });
  assertDefaultsCanBeUsed({
    name: "test",
    options: [
      { name: "--o", args: [{ default: "x" }, { default: "y" }, {}] },
      { name: "--p", args: [{}, { isOptional: true, default: "x" }] },
      { name: "--q", isRequired: true, args: { isOptional: true, default: "x" } },
    ],
  });
  expect(() => assertDefaultsCanBeUsed({ name: "test", args: { name: "a", default: "x" } })).toThrow(
    "argument a has a default, but it's required",
  );
  expect(() =>
    assertDefaultsCanBeUsed({
      name: "test",
      options: [{ name: "--o", args: [{}, { name: "b", default: "x" }] }],
    }),
  ).toThrow("the argument at index 0 has none");
  expect(() =>
    assertDefaultsCanBeUsed({
      name: "test",
      options: [{ name: "--o", isRequired: true, args: { default: "x" } }],
    }),
  ).toThrow("has a default, but the option is required");
});
