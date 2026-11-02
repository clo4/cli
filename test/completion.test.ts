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
// Runtime resolver (the default --runtime mode's engine)
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
// Mode dispatch + the `complete` / shells subcommands
// ---------------------------------------------------------------------------

test("default mode emits the thin runtime shim", () => {
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

  const ungated = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--", "build", ""]),
  );
  expectIncludes(ungated.stdout, "--out");
});

test("completion subcommand defaults to runtime, --shell opts out", async () => {
  const runtime = await captureConsole(() => run(fixture, ["completion", "bash"]));
  expect(runtime.code).toBe(0);
  expectIncludes(runtime.stdout, "completion complete --");

  const shell = await captureConsole(() => run(fixture, ["completion", "bash", "--shell"]));
  expect(shell.code).toBe(0);
  expectIncludes(shell.stdout, "complete -F _forge 'forge'");
  expectNotIncludes(shell.stdout, "completion complete --");
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
  const result = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--", "remote", ""]),
  );
  expect(result.code).toBe(0);
  expectIncludes(result.stdout, "remove");
});

// ---------------------------------------------------------------------------
// Static --shell mode: bug fixes (positional emission, fish -x, guards)
// ---------------------------------------------------------------------------

const genSpec: Spec = {
  name: "forge",
  subcommands: [
    {
      name: "deploy",
      options: [
        {
          name: "--target",
          description: "Target",
          args: {
            name: "t",
            generators: { custom: async () => ["staging", "production"] },
          },
        },
        { name: "--config", args: { name: "f", template: "filepaths" } },
        { name: "--mode", args: { name: "m", suggestions: ["fast", "slow"] } },
        { name: "--out", args: { name: "dir", template: "folders" } },
      ],
    },
    completion,
  ],
};

test("static fish uses -x so its own candidates don't leak file completion", () => {
  const script = getCompletion(genSpec, "fish", "shell");
  // static suggestions and generators: exclusive, no file fallback
  expectIncludes(script, "-l 'mode' -x -a 'fast slow'");
  expectIncludes(script, "-l 'out' -x -a '(__fish_complete_directories)'");
  expectIncludes(script, "-l 'target' -x -a '(set -l c");
  // filepaths still wants files: -r re-enables fish's file completion
  expectIncludes(script, "-l 'config' -r");
});

test("static fish guards the generator callback and supports a relative binary", () => {
  const script = getCompletion(genSpec, "fish", "shell");
  expectIncludes(script, 'command -q -- $c; or test -x "$c"');
  expectIncludes(script, "completion generate-suggestions ");
});

test("static modes emit positional argument completion", () => {
  const bash = getCompletion(fixture, "bash", "shell");
  // build's filepaths positional -> file completion appended to the node
  expectIncludes(bash, "compgen -f");
  const fish = getCompletion(fixture, "fish", "shell");
  // completion's shell positional (suggestions) -> -a candidates
  expectIncludes(fish, "bash zsh fish");
});

test("static generate-suggestions round-trips the encoded location", async () => {
  const script = getCompletion(genSpec, "fish", "shell");
  const match = script.match(/generate-suggestions (\S+) /);
  expect(match).not.toBeNull();
  const location = match![1];
  const result = await captureConsole(() =>
    run(genSpec, ["completion", "generate-suggestions", location, "--", "deploy", "--target"]),
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("staging\nproduction\n");
});

test("generate-suggestions rejects an invalid location", async () => {
  const result = await captureConsole(() =>
    run(genSpec, ["completion", "generate-suggestions", "@@not-base64@@"]),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unknown generator location/);
});
