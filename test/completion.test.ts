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

test("runtime: a short option's attached value completes after a separator", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "-m", args: { name: "m", suggestions: ["fast", "slow"] } }],
  };
  expect(values(await resolve(spec, [], "-m="))).toEqual(["-m=fast", "-m=slow"]);
});

test("runtime: a POSIX-noncompliant option's attached value completes", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { flagsArePosixNoncompliant: true },
    options: [{ name: "mode", args: { name: "m", suggestions: ["fast", "slow"] } }],
  };
  expect(values(await resolve(spec, [], "mode="))).toEqual(["mode=fast", "mode=slow"]);
});

test("runtime: an option's later arguments use their own suggestions", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      {
        name: "--pair",
        args: [
          { name: "a", suggestions: ["A"] },
          { name: "b", suggestions: ["B"] },
        ],
      },
    ],
  };
  expect(values(await resolve(spec, ["--pair"], ""))).toEqual(["A"]);
  expect(values(await resolve(spec, ["--pair", "x"], ""))).toEqual(["B"]);
});

test("runtime: a subcommand without separators doesn't complete attached values", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--mode", isPersistent: true, args: { name: "m", suggestions: ["fast"] } }],
    subcommands: [{ name: "sub", parserDirectives: { optionArgSeparators: [] } }],
  };
  expect(values(await resolve(spec, [], "--mode="))).toEqual(["--mode=fast"]);
  expect(values(await resolve(spec, ["sub"], "--mode="))).not.toContain("--mode=fast");
  expect(values(await resolve(spec, ["sub", "--mode"], ""))).toEqual(["fast"]);
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
  const v = values(await resolve(openOptionSpec, ["--tags", "a"], ""));
  expect(v).toContain("T1");
  expect(v).toContain("--watch");
  expect(v).not.toContain("--tags");
  expect(v).not.toContain("P1");
});

test("runtime: a variadic option's attached value is its only value", async () => {
  const v = values(await resolve(openOptionSpec, ["--tags=a"], ""));
  expect(v).not.toContain("T1");
  expect(v).toContain("P1");
  expect(v).toContain("--watch");
});

test("runtime: a variadic option without suggestions still offers options", async () => {
  expect(values(await resolve(openOptionSpec, ["--names=a"], ""))).toContain("--watch");
});

test("runtime: gateOptions applies after a variadic option's first value", async () => {
  expect(values(await resolve(openOptionSpec, ["--tags", "a"], "", true))).toEqual(["T1"]);
  const dashed = values(await resolve(openOptionSpec, ["--tags", "a"], "-", true));
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

test("runtime: a requiresSeparator string is offered as that separator", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--sep", requiresSeparator: ":", args: { name: "v" } }],
  };
  expect(values(await resolve(spec, [], ""))).toContain("--sep:");
});

test("runtime: exclusiveOn hides the option an earlier option excludes", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--a", exclusiveOn: ["--b"] }, { name: "--b" }, { name: "--c" }],
  };
  const v = values(await resolve(spec, ["--b"], ""));
  expect(v).not.toContain("--a");
  expect(v).toContain("--c");
});

test("runtime: dependsOn is noted in the description", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: "--a", description: "Use a", dependsOn: ["--b", "--c"] },
      { name: "--d", dependsOn: ["--b"] },
      { name: "--b" },
      { name: "--c" },
    ],
  };
  const candidates = await resolve(spec, [], "");
  expect(candidates.find((c) => c.value === "--a")?.description).toBe("Use a (requires --b, --c)");
  expect(candidates.find((c) => c.value === "--d")?.description).toBe("requires --b");
});

test("runtime: a persistent repeatable option's limit counts uses in parent commands", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "-v", isRepeatable: 2, isPersistent: true }],
    subcommands: [{ name: "sub" }],
  };
  expect(values(await resolve(spec, ["-v", "sub"], ""))).toContain("-v");
  expect(values(await resolve(spec, ["-v", "sub", "-v"], ""))).not.toContain("-v");
});

test("runtime: a subcommand inherits option arg separators", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { optionArgSeparators: ":" },
    subcommands: [
      {
        name: "sub",
        options: [
          { name: "--mode", args: { name: "m", suggestions: ["fast", "slow"] } },
          { name: "--sep", requiresSeparator: true, args: { name: "v" } },
        ],
      },
    ],
  };
  // The shell filters candidates by prefix, so both values come back.
  expect(values(await resolve(spec, ["sub"], "--mode:f"))).toEqual(["--mode:fast", "--mode:slow"]);
  expect(values(await resolve(spec, ["sub"], "--mode=f"))).not.toContain("--mode=fast");
  expect(values(await resolve(spec, ["sub"], ""))).toContain("--sep:");
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

test("runtime: a subcommand can turn off optionsMustPrecedeArguments", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { optionsMustPrecedeArguments: true },
    subcommands: [
      {
        name: "sub",
        parserDirectives: { optionsMustPrecedeArguments: false },
        args: { name: "a" },
        options: [{ name: "--f" }],
      },
    ],
  };
  expect(values(await resolve(spec, ["sub", "arg"], ""))).toContain("--f");
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

test("runtime: attached option values aren't offered where options can't be used", async () => {
  const option = { name: "--mode", args: { name: "m", suggestions: ["debug"] } };
  const afterSeparator: Spec = { name: "x", args: { name: "a", isVariadic: true }, options: [option] };
  expect(values(await resolve(afterSeparator, ["--"], "--mode="))).not.toContain("--mode=debug");
  const afterArgument: Spec = {
    name: "x",
    parserDirectives: { optionsMustPrecedeArguments: true },
    args: { name: "a", isVariadic: true },
    options: [option],
  };
  expect(values(await resolve(afterArgument, [], "--mode="))).toContain("--mode=debug");
  expect(values(await resolve(afterArgument, ["arg"], "--mode="))).not.toContain("--mode=debug");
});

test("runtime: a subcommand's identical repeatable option continues the parent's count", async () => {
  const verbose = { name: "-v", isRepeatable: 2 } as const;
  const spec: Spec = {
    name: "x",
    options: [verbose],
    subcommands: [{ name: "sub", options: [{ ...verbose }] }],
  };
  expect(values(await resolve(spec, ["sub", "-v"], ""))).toContain("-v");
  expect(values(await resolve(spec, ["-v", "sub", "-v"], ""))).not.toContain("-v");
});

test("runtime: an option that another option shadows isn't offered", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: "--g", isPersistent: true, description: "parent" },
      { name: ["-k", "--keep"], isPersistent: true, description: "still reachable" },
    ],
    subcommands: [
      {
        name: "sub",
        options: [
          { name: "--g", description: "child" },
          { name: "--keep", isPersistent: true, description: "child keep" },
        ],
      },
    ],
  };
  const candidates = await resolve(spec, ["sub"], "");
  expect(candidates.filter((c) => c.value === "--g").map((c) => c.description)).toEqual(["child"]);
  expect(candidates.map((c) => c.description)).toContain("still reachable");
});

test("runtime: a shadowed name is offered only for the option it refers to", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: ["-a", "--all"], description: "first" },
      { name: "--all", description: "second" },
    ],
  };
  const candidates = (await resolve(spec, [], "")).map((c) => `${c.value}:${c.description}`);
  expect(candidates).toEqual(["-a:first", "--all:second"]);
});

test("runtime: an attached value completes for the option the parser would pick", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: ["-c", "--config"], isPersistent: true, args: { suggestions: ["ROOT"] } }],
    subcommands: [
      { name: "sub", options: [{ name: "--config", isPersistent: true, args: { suggestions: ["SUB"] } }] },
    ],
  };
  expect(values(await resolve(spec, ["sub"], "--config="))).toEqual(["--config=SUB"]);
  expect(values(await resolve(spec, ["sub"], "-c="))).toEqual(["-c=ROOT"]);
});

test("runtime: a chained short option's attached value completes", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "-v" }, { name: "-o", args: { suggestions: ["out"] } }],
  };
  expect(values(await resolve(spec, [], "-vo="))).toEqual(["-vo=out"]);
  expect(values(await resolve(spec, [], "-o"))).toContain("-o");
  expect(values(await resolve(spec, [], "-ou"))).toEqual(["-oout"]);
});

test("runtime: an attached value only completes after the separator the option requires", async () => {
  const spec: Spec = {
    name: "x",
    parserDirectives: { optionArgSeparators: ["=", ":"] },
    options: [{ name: "--o", requiresSeparator: ":", args: { suggestions: ["v"] } }],
  };
  expect(values(await resolve(spec, [], "--o="))).not.toContain("--o=v");
  expect(values(await resolve(spec, [], "--o:"))).toEqual(["--o:v"]);
});

test("runtime: an optional option value is offered with what else can come next", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: "--color", args: { isOptional: true, suggestions: ["always"] } },
      { name: "--verbose" },
    ],
    subcommands: [{ name: "build" }],
  };
  expect(values(await resolve(spec, ["--color"], ""))).toEqual(["always", "build", "--verbose"]);
});

test("runtime: exclusiveOn on an option used in a parent command hides the option", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: "--x", exclusiveOn: ["--y"] },
      { name: "--y", isPersistent: true },
    ],
    subcommands: [{ name: "s" }],
  };
  expect(values(await resolve(spec, ["s"], ""))).toContain("--y");
  expect(values(await resolve(spec, ["--x", "s"], ""))).not.toContain("--y");
});

test("runtime: an option isn't offered under a name that a subcommand matches", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: ["-f", "--foo"], description: "option" }],
    subcommands: [{ name: "--foo", description: "subcommand" }],
  };
  const candidates = (await resolve(spec, [], "")).map((c) => `${c.value}:${c.description}`);
  expect(candidates).toEqual(["--foo:subcommand", "-f:option"]);
});

test("runtime: gateOptions offers dashed suggestions after '--', where they're arguments", async () => {
  const spec: Spec = {
    name: "demo",
    action: () => {},
    args: { name: "n", isVariadic: true, suggestions: ["-1", "-2", "3"] },
  };
  expect(values(await resolve(spec, ["--"], "-", true))).toEqual(["-1", "-2", "3"]);
  // Once options must stop, too.
  const stopped: Spec = { ...spec, parserDirectives: { optionsMustPrecedeArguments: true } };
  expect(values(await resolve(stopped, ["a"], "-", true))).toEqual(["-1", "-2", "3"]);
});
