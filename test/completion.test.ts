import { expect, test } from "vitest";

import { completeRuntime, completion, getCompletion } from "../src/completion.js";
import { run } from "../src/index.js";
import type { Spec } from "../src/types.js";
import { captureConsole, expectIncludes, expectNotIncludes } from "./helpers.js";

const fixture: Spec = {
  name: "forge",
  description: "Build orchestrator",
  options: [
    { name: ["-h", "--help"], description: "Show help", isPersistent: true },
    { name: "--secret", description: "a hidden option", hidden: true },
  ],
  subcommands: [
    {
      name: ["build", "b"],
      description: "Build inputs",
      args: { name: "inputs", isVariadic: true, template: "filepaths" },
      options: [{ name: "--out", description: "Output dir", args: { name: "dir" } }],
    },
    {
      name: "remote",
      description: "Manage remotes",
      subcommands: [
        { name: ["remove", "rm"], description: "Remove a remote" },
        { name: "ghost", description: "a hidden command", hidden: true },
      ],
    },
    completion,
  ],
};

// ---------------------------------------------------------------------------
// Runtime resolver
// ---------------------------------------------------------------------------

const values = (cands: { value: string }[]) => cands.map((c) => c.value);

const resolve = (spec: Spec, before: readonly string[], partial: string, gateOptions?: boolean) =>
  completeRuntime({ spec, before, partial, gateOptions });

test("runtime: top level offers subcommands and persistent options", async () => {
  const v = values(await resolve(fixture, [], ""));
  expect(v).toContain("build");
  expect(v).toContain("b");
  expect(v).toContain("remote");
  expect(v).toContain("--help");
  expect(v).not.toContain("--secret"); // hidden
  expect(v).not.toContain("ghost");
});

test("runtime: subcommands are dropped once a option-arg is being completed", async () => {
  // `remote ` offers its subcommands, not the parent's.
  const v = values(await resolve(fixture, ["remote"], ""));
  expect(v).toContain("remove");
  expect(v).toContain("rm");
  expect(v).not.toContain("build");
});

test("runtime: positional template enumerates the filesystem", async () => {
  // build's variadic positional has template:filepaths.
  const v = values(await resolve(fixture, ["build"], "package."));
  expect(v).toContain("package.json");
});

test("runtime: pending option value runs a custom generator with no file leak", async () => {
  const spec: Spec = {
    name: "x",
    subcommands: [
      {
        name: "deploy",
        options: [
          {
            name: ["-t", "--target"],
            args: { name: "t", generators: { custom: () => ["staging", "production"] } },
          },
        ],
      },
    ],
  };
  const v = values(await resolve(spec, ["deploy", "-t"], ""));
  expect(v).toEqual(["staging", "production"]); // exactly the generator output
});

test("runtime: static suggestions complete a option value", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--mode", args: { name: "m", suggestions: ["fast", "slow"] } }],
  };
  const v = values(await resolve(spec, ["--mode"], ""));
  expect(v).toEqual(["fast", "slow"]);
});

test("runtime: an attached =value completes the option value", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--mode", args: { name: "m", suggestions: ["fast", "slow"] } }],
  };
  const v = values(await resolve(spec, [], "--mode="));
  expect(v).toEqual(["--mode=fast", "--mode=slow"]);
});

const openOptionSpec: Spec = {
  name: "open",
  args: { name: "path", isOptional: true, isVariadic: true, suggestions: ["P1", "P2"] },
  options: [
    { name: "--color", args: { isOptional: true, suggestions: ["auto", "never"] } },
    { name: "--tags", args: { isVariadic: true, suggestions: ["T1"] } },
    { name: "--names", args: { isVariadic: true } },
    { name: "--watch" },
  ],
};

test("runtime: '--' closes an open option", async () => {
  for (const before of [
    ["--color", "--"],
    ["--tags", "a", "--"],
    ["--tags", "a", "--", "b"],
  ]) {
    expect(values(await resolve(openOptionSpec, before, ""))).toEqual(["P1", "P2"]);
  }
});

test("runtime: a variadic option offers values and options after its first value", async () => {
  for (const before of [["--tags=a"], ["--tags", "a"]]) {
    const v = values(await resolve(openOptionSpec, before, ""));
    expect(v).toContain("T1");
    expect(v).toContain("--watch");
    expect(v).not.toContain("--tags");
    expect(v).not.toContain("P1");
  }
});

test("runtime: a variadic option without suggestions still offers options", async () => {
  expect(values(await resolve(openOptionSpec, ["--names=a"], ""))).toContain("--watch");
});

test("runtime: gateOptions applies after a variadic option's first value", async () => {
  expect(values(await resolve(openOptionSpec, ["--tags=a"], "", true))).toEqual(["T1"]);
  const dashed = values(await resolve(openOptionSpec, ["--tags=a"], "-", true));
  expect(dashed).toContain("--watch");
  expect(dashed).not.toContain("T1");
});

test("runtime: a required option value is offered alone", async () => {
  expect(values(await resolve(openOptionSpec, ["--tags"], ""))).toEqual(["T1"]);
});

test("runtime: subcommands are offered after an option's value", async () => {
  const spec: Spec = {
    name: "git",
    options: [{ name: "-C", args: {} }],
    subcommands: [{ name: "status" }, { name: "log" }],
  };
  for (const before of [["-C", "/repo"], ["-C=/repo"]]) {
    expect(values(await resolve(spec, before, ""))).toEqual(["status", "log"]);
  }
});

test("runtime: a custom generator receives the current tokens", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      {
        name: "--t",
        args: { name: "t", generators: { custom: (tokens) => [`n:${tokens.length}`] } },
      },
    ],
  };
  const v = values(await resolve(spec, ["--t"], "pre"));
  expect(v).toEqual(["n:2"]); // ["--t", "pre"]
});

test("runtime: isRepeatable and exclusiveOn filter the option list", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: "--once" },
      { name: "-v", isRepeatable: true },
      { name: "-w", isRepeatable: 2 },
      { name: "--a", exclusiveOn: ["--b"] },
      { name: "--b" },
    ],
  };
  const used = values(await resolve(spec, ["--once", "-v", "-w", "-w", "--a"], ""));
  expect(used).not.toContain("--once"); // non-repeatable, already present
  expect(used).toContain("-v"); // repeatable, stays
  expect(used).not.toContain("-w"); // numeric cap (2) reached
  expect(used).not.toContain("--b"); // excluded by present --a
  expect(used).not.toContain("--a"); // non-repeatable, already present
});

test("runtime: requiresSeparator options are offered in their attached form", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--sep", requiresSeparator: true, args: { name: "v" } }],
  };
  const v = values(await resolve(spec, [], ""));
  expect(v).toContain("--sep=");
});

test("runtime: optionsMustPrecedeArguments hides options after a positional", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { optionsMustPrecedeArguments: true },
    args: { name: "a" },
    options: [{ name: "--f" }],
  };
  expect(values(await resolve(spec, [], ""))).toContain("--f");
  expect(values(await resolve(spec, ["arg"], ""))).not.toContain("--f");
});

test("runtime: required options are annotated", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--need", isRequired: true, description: "needed" }],
  };
  const [first] = await resolve(spec, [], "");
  expect(first.value).toBe("--need");
  expect(first.description).toMatch(/\[required\]/);
});

test("runtime: gateOptions hides options until the token starts with a dash", async () => {
  // Ungated (default): options show on a bare token.
  expect(values(await resolve(fixture, ["build"], ""))).toContain("--out");

  // Gated + bare token: subcommands/positionals only, no options.
  const bare = values(await resolve(fixture, ["build"], "", true));
  expect(bare).not.toContain("--out");
  expect(bare).not.toContain("--help");
  expect(bare).toContain("package.json"); // positional template still completes

  // Gated + dashed token: options only.
  const dashed = values(await resolve(fixture, ["build"], "-", true));
  expect(dashed).toContain("--out");
  expect(dashed).toContain("--help");
});

test("runtime: gateOptions exempts posix-noncompliant options (no dash to gate on)", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "start" }, { name: "stop" }],
  };
  const v = values(await resolve(spec, [], "", true));
  expect(v).toContain("start");
  expect(v).toContain("stop");
});

// ---------------------------------------------------------------------------
// The shim and the `completion` / `complete` subcommands
// ---------------------------------------------------------------------------

test("getCompletion emits the shim", () => {
  const bash = getCompletion(fixture, "bash");
  expectIncludes(bash, "completion complete --");
  expectIncludes(bash, 'command -v "$bin"'); // guarded
  expectIncludes(bash, "complete -F _forge_complete 'forge'");

  const fish = getCompletion(fixture, "fish");
  expectIncludes(fish, "function __forge_complete");
  expectIncludes(fish, 'command -q -- $bin; or test -x "$bin"');
});

test("runtime shims gate options for bash and fish but not zsh", () => {
  expectIncludes(getCompletion(fixture, "bash"), "completion complete --gate-options --");
  expectIncludes(getCompletion(fixture, "fish"), "completion complete --gate-options --");
  // zsh keeps its convention of surfacing options, so no gating option.
  const zsh = getCompletion(fixture, "zsh");
  expectIncludes(zsh, "completion complete --");
  expectNotIncludes(zsh, "--gate-options");
});

test("complete subcommand honors --gate-options", async () => {
  const gated = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--gate-options", "--", "build", ""]),
  );
  expect(gated.code).toBe(0);
  expectNotIncludes(gated.stdout, "--out");

  const ungated = await captureConsole(() => run(fixture, ["completion", "complete", "--", "build", ""]));
  expectIncludes(ungated.stdout, "--out");
});

test("completion subcommand prints the shim", async () => {
  const result = await captureConsole(() => run(fixture, ["completion", "bash"]));
  expect(result.code).toBe(0);
  expectIncludes(result.stdout, "completion complete --");
});

test("completion subcommand lists shells when none is given", async () => {
  const result = await captureConsole(() => run(fixture, ["completion"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("Supported shells: bash, zsh, fish\n");
});

test("completion subcommand rejects an unknown shell", async () => {
  const result = await captureConsole(() => run(fixture, ["completion", "powershell"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unsupported shell 'powershell'/);
});

test("complete subcommand prints resolver candidates", async () => {
  const result = await captureConsole(() => run(fixture, ["completion", "complete", "--", "remote", ""]));
  expect(result.code).toBe(0);
  expectIncludes(result.stdout, "remove");
});
