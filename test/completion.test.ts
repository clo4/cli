import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "vitest";

import { completeRuntime, completion, formatCandidates, getCompletion } from "../src/completion.js";
import type { Shell } from "../src/completion.js";
import { helpCommand } from "../src/help.js";
import { run } from "../src/index.js";
import { parse } from "../src/parse.js";
import type { Spec, Subcommand } from "../src/types.js";
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

test("runtime: a Windows path can use backslashes", async () => {
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    expect(values(await resolve(fixture, ["build"], "test\\completion."))).toContain(
      "test\\completion.test.ts",
    );
    expect(values(await resolve(fixture, ["build"], "tes"))).toContain("test/");
    expect(values(await resolve(fixture, ["build"], "src\\..\\tes"))).toContain("src\\..\\test\\");
  } finally {
    Object.defineProperty(process, "platform", platform);
  }
  // Elsewhere a backslash is part of a name.
  expect(values(await resolve(fixture, ["build"], "test\\completion."))).not.toContain(
    "test\\completion.test.ts",
  );
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
  // The parser reads `-` and `--w` here as values of --tags, so they complete
  // values too.
  for (const partial of ["-", "--w"]) {
    const dashed = values(await resolve(openOptionSpec, ["--tags", "a"], partial, true));
    expect(dashed).toContain("--watch");
    expect(dashed).toContain("T1");
  }
  expect(values(await resolve(openOptionSpec, ["--tags", "a"], "--watch", true))).not.toContain("T1");
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

test("runtime: a subcommand's copy of a used option isn't offered again", async () => {
  // The parser reads the copy as the same option, because it has the same names.
  const spec: Spec = {
    name: "x",
    options: [{ name: "--x" }],
    subcommands: [{ name: "sub", options: [{ name: "--x" }, { name: "--y" }] }],
  };
  expect(values(await resolve(spec, ["--x", "sub"], ""))).toEqual(["--y"]);
});

test("runtime: a hidden option isn't offered, but still shadows", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: ["-a", "--all"], isPersistent: true }],
    subcommands: [{ name: "sub", options: [{ name: "--all", hidden: true }] }],
  };
  expect(values(await resolve(spec, ["sub"], ""))).toEqual(["-a"]);
});

test("runtime: an inherited subcommand is offered by the names nothing nearer takes", async () => {
  const spec: Spec = {
    name: "app",
    subcommands: [
      { name: "a", subcommands: [{ name: "x" }] },
      { name: ["x", "y"], isPersistent: true },
    ],
  };
  expect(values(await resolve(spec, ["a"], ""))).toEqual(["x", "y"]);
  expect(parse(["a", "x"], spec).path.map((command) => command.name)).toEqual(["app", "a", "x"]);
  expect(parse(["a", "y"], spec).path.map((command) => command.name)).toEqual(["app", "a", ["x", "y"]]);
});

test("runtime: requiresSeparator options are offered in their attached form", async () => {
  const spec: Spec = {
    name: "x",
    options: [{ name: "--sep", requiresSeparator: true, args: { name: "v" } }],
  };
  const v = values(await resolve(spec, [], ""));
  expect(v).toContain("--sep=");
});

test("runtime: an option named '-' or '+' isn't offered until its value is typed", async () => {
  const spec: Spec = {
    name: "x",
    options: [
      { name: ["-", "--lines"], args: { suggestions: ["10"] } },
      { name: "+", args: {} },
    ],
  };
  expect(values(await resolve(spec, [], ""))).toEqual(["--lines"]);
  expect(values(await resolve(spec, [], "-1"))).toContain("-10");
});

test("runtime: a requiresSeparator option without arguments is offered without the separator", async () => {
  const spec: Spec = { name: "x", options: [{ name: "--flag", requiresSeparator: true }] };
  expect(values(await resolve(spec, [], ""))).toEqual(["--flag"]);
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

test("runtime: gateOptions offers values for a dashed word the parser reads as one", async () => {
  const spec: Spec = {
    name: "t",
    args: { name: "x", suggestions: ["-", "a"] },
    options: [{ name: "--o" }],
  };
  expect(parse(["-"], spec).args).toEqual(["-"]);
  const v = values(await resolve(spec, [], "-", true));
  expect(v).toContain("-");
  expect(v).toContain("--o");
  // A word the parser reads as an option still completes options only.
  expect(values(await resolve(spec, [], "--o", true))).toEqual(["--o"]);
});

test("runtime: gateOptions offers a dashed subcommand once the word starts its name", async () => {
  const spec: Spec = {
    name: "x",
    args: { name: "file", isOptional: true, suggestions: ["--arg-value"] },
    options: [{ name: "-f" }],
    subcommands: [{ name: "--version" }, { name: "--hidden", hidden: true }],
  };
  expect(values(await resolve(spec, [], "--v", true))).toEqual(["--version"]);
  // The parser reads the full name as the subcommand, so values aren't held back.
  expect(values(await resolve(spec, [], "--version", true))).toContain("--version");
  expect(values(await resolve(spec, [], "--h", true))).toEqual([]);
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

test("getCompletion emits the PowerShell shim", () => {
  const powershell = getCompletion(fixture, "powershell");
  expectIncludes(powershell, "Register-ArgumentCompleter -Native -CommandName 'forge'");
  expectIncludes(powershell, "Get-Command $bin"); // guarded
  // `--` goes through an array, so PowerShell passes it on.
  expectIncludes(
    powershell,
    "$arguments = @('completion', 'complete', '--shell', 'powershell', '--gate-options')",
  );
  expectIncludes(powershell, "$arguments += '--'");
  expectIncludes(powershell, "& $bin @arguments");
});

test("the PowerShell shim makes a CompletionResult from each line's fields", () => {
  const powershell = getCompletion(fixture, "powershell");
  // `foreach` runs no times when the CLI prints nothing.
  expectIncludes(powershell, "foreach ($line in $lines) {");
  expectIncludes(powershell, '$text, $value, $tooltip = $line -split "`t", 3');
  expectIncludes(powershell, "CompletionResult]::new($text, $value, 'ParameterValue', $tooltip)");
});

test("the PowerShell shim passes an empty word as --empty-word", () => {
  // Windows PowerShell drops an empty argument to a native command.
  const powershell = getCompletion(fixture, "powershell");
  expectIncludes(powershell, "if ($partial -eq '') { $arguments += '--empty-word' }");
  expectIncludes(powershell, "if ($partial -ne '') { $arguments += $partial }");
});

test("the PowerShell shim runs a quoted command path without its quotes", () => {
  const powershell = getCompletion(fixture, "powershell");
  expectIncludes(powershell, "StringConstantExpressionAst]) { $first.Value } else { $first.Extent.Text }");
});

test("the PowerShell shim passes a quoted word without its opening quote", () => {
  const powershell = getCompletion(fixture, "powershell");
  expectIncludes(powershell, `if ($partial.StartsWith("'")) { $partial = $partial.Substring(1)`);
  expectIncludes(powershell, `elseif ($partial.StartsWith('"')) { $partial = $partial.Substring(1)`);
  expectNotIncludes(powershell, "$arguments += $wordToComplete");
});

test("getCompletion emits the Nushell shim", () => {
  const nushell = getCompletion(fixture, "nushell");
  expectIncludes(nushell, "let __forge_previous_completer = $env.config.completions.external.completer?");
  // A command on Windows can be typed with its extension.
  expectIncludes(
    nushell,
    "if ($command | path basename) not-in ['forge' 'forge.exe' 'forge.cmd' 'forge.bat'] {",
  );
  expectIncludes(nushell, "do $__forge_previous_completer $spans"); // other commands
  expectIncludes(nushell, "if (which $command | is-empty) { return }"); // guarded
});

test("the Nushell shim passes words without their quotes", () => {
  const nushell = getCompletion(fixture, "nushell");
  expectIncludes(nushell, `if $quote in ["'", '"', '\`'] {`);
  expectIncludes(
    nushell,
    "^$command completion complete --shell nushell --gate-options -- ...($words | skip 1)",
  );
});

const nu = (() => {
  try {
    execFileSync("nu", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** Quote a string for sh. */
const shQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/**
 * Write a fake CLI to `file` that appends its arguments to `log`, one call per
 * line with each argument in angle brackets. It prints what `completion complete --shell` prints for `candidates`
 * when its last argument is one of `words`.
 */
function writeFakeCli(
  file: string,
  shell: Shell,
  candidates: Parameters<typeof formatCandidates>[0],
  words: readonly string[],
  log: string,
): void {
  const cases = words.map((word) => {
    const lines = formatCandidates(candidates, shell, word);
    const out = lines.length > 0 ? `printf '%s\\n' ${shQuote(lines.join("\n"))}` : ":";
    return `  ${shQuote(word)}) ${out} ;;`;
  });
  const script = [
    "#!/bin/sh",
    `{ printf '<%s>' "$@"; echo; } >> ${shQuote(log)}`,
    "for word; do :; done",
    'case "$word" in',
    ...cases,
    "esac",
    "",
  ];
  writeFileSync(file, script.join("\n"), { mode: 0o755 });
}

// Runs the generated script in real Nushell, with spans shaped the way Nushell
// passes them: each word as typed, quotes included.
test.skipIf(!nu || process.platform === "win32")("the Nushell shim runs in Nushell", () => {
  const dir = mkdtempSync(join(tmpdir(), "clo4-cli-nu-"));
  try {
    const bin = join(dir, "with space");
    mkdirSync(bin);
    const log = join(dir, "args");
    const forge = join(bin, "forge");
    const candidates = [
      { value: "my file.txt", description: "A file" },
      { value: "other" },
      { value: "build" },
    ];
    writeFakeCli(forge, "nushell", candidates, ["my f", "bu", "ot"], log);
    copyFileSync(forge, join(bin, "forge.exe"));
    writeFileSync(join(dir, "shim.nu"), getCompletion(fixture, "nushell"));
    const cases = [
      ["forge", "build", "'my f"],
      ["forge", "build", '"my f'],
      [`'${forge}'`, "bu"],
      ["forge.exe", "ot"],
      ["other", "x"],
    ];
    const script = [
      `source '${join(dir, "shim.nu")}'`,
      `let complete = $env.config.completions.external.completer`,
      `${JSON.stringify(cases)} | each {|spans| do $complete $spans | default [] | get value? | default [] } | to json`,
    ].join("\n");
    const output = execFileSync("nu", ["--no-config-file", "-c", script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      encoding: "utf8",
    });
    expect(JSON.parse(output)).toEqual([["'my file.txt'"], ["'my file.txt'"], ["build"], ["other"], []]);
    expect(readFileSync(log, "utf8").split("\n")).toEqual([
      "<completion><complete><--shell><nushell><--gate-options><--><build><my f>",
      "<completion><complete><--shell><nushell><--gate-options><--><build><my f>",
      "<completion><complete><--shell><nushell><--gate-options><--><bu>",
      "<completion><complete><--shell><nushell><--gate-options><--><ot>",
      "",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("shims quote a name with a quote in it", () => {
  const spec: Spec = { name: "it's", subcommands: [completion] };
  expectIncludes(getCompletion(spec, "powershell"), "-CommandName 'it''s'");
  expectIncludes(getCompletion(spec, "nushell"), `not-in ["it's" "it's.exe"`);
});

test("runtime shims gate options for every shell but zsh", () => {
  for (const shell of ["bash", "fish", "powershell", "nushell"] as const) {
    expectIncludes(getCompletion(fixture, shell), "--gate-options");
  }
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

test("complete subcommand reads every token as before an empty word with --empty-word", async () => {
  const result = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--empty-word", "--", "remote"]),
  );
  expect(result.code).toBe(0);
  // Without the flag, "remote" would be the word being completed.
  const offered = result.stdout.split("\n").map((line) => line.split("\t")[0]);
  expect(offered).toContain("remove");
  expect(offered).not.toContain("build");
});

test("completion subcommand prints the shim", async () => {
  const result = await captureConsole(() => run(fixture, ["completion", "bash"]));
  expect(result.code).toBe(0);
  expectIncludes(result.stdout, "completion complete --");
});

test("completion subcommand lists shells when none is given", async () => {
  const result = await captureConsole(() => run(fixture, ["completion"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("Supported shells: bash, zsh, fish, powershell, nushell\n");
});

test("completion subcommand rejects an unknown shell", async () => {
  const result = await captureConsole(() => run(fixture, ["completion", "tcsh"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unsupported shell 'tcsh'/);
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

// ---------------------------------------------------------------------------
// Completing the names after `help`
// ---------------------------------------------------------------------------

const helpFixture = (help: Subcommand): Spec => ({
  name: "demo",
  options: [{ name: ["-h", "--help"], isPersistent: true }],
  subcommands: [
    help,
    {
      name: ["build", "b"],
      description: "Build inputs",
      args: { name: "inputs", isVariadic: true },
      options: [{ name: "--out", args: { name: "dir" } }],
    },
    {
      name: "remote",
      description: "Manage remotes",
      subcommands: [{ name: ["remove", "rm"] }, { name: "ghost", hidden: true }],
    },
    { name: "secret", hidden: true },
  ],
});

test("runtime: help offers the subcommands of its parent", async () => {
  const v = values(await resolve(helpFixture(helpCommand), ["help"], ""));
  expect(v).toEqual(expect.arrayContaining(["help", "build", "b", "remote", "-h", "--help"]));
  expect(v).not.toContain("secret");
});

test("runtime: help offers the subcommands of the command its names lead to", async () => {
  const spec = helpFixture(helpCommand);
  const remote = await resolve(spec, ["help", "remote"], "");
  expect(values(remote)).toEqual(expect.arrayContaining(["remove", "rm"]));
  expect(values(remote)).not.toContain("ghost");
  expect(values(remote)).not.toContain("build");
  expect(remote.find((c) => c.value === "remove")).toBeDefined();
  expect(values(await resolve(spec, ["help", "build"], ""))).toEqual(["-h", "--help"]);
  expect(values(await resolve(spec, ["help", "remote", "remove"], ""))).toEqual(["-h", "--help"]);
  expect(values(await resolve(spec, ["help", "nope"], ""))).toEqual(["-h", "--help"]);
});

test("runtime: help's subcommand names carry their descriptions", async () => {
  const candidates = await resolve(helpFixture(helpCommand), ["help"], "b");
  expect(candidates).toContainEqual({ value: "build", description: "Build inputs" });
});

test("runtime: a persistent help command offers the subcommands of the command it's used in", async () => {
  const spec = helpFixture({ ...helpCommand, isPersistent: true });
  const v = values(await resolve(spec, ["remote", "help"], ""));
  expect(v).toEqual(expect.arrayContaining(["remove", "rm", "-h", "--help"]));
  expect(v).not.toContain("build");
  // Help reads its own name here as the end of the names, so it isn't offered.
  expect(values(await resolve(spec, ["help", "remote"], ""))).not.toContain("help");
});

test("runtime: help offers the persistent subcommands the command its names lead to inherits", async () => {
  const spec: Spec = {
    name: "demo",
    subcommands: [
      { name: "status", description: "Show the status", isPersistent: true },
      { name: "leaf", description: "A leaf" },
      helpCommand,
    ],
  };
  const candidates = await resolve(spec, ["help", "leaf"], "");
  expect(candidates).toEqual([{ value: "status", description: "Show the status" }]);
});

test("runtime: gateOptions offers help's subcommand names until the word starts with a dash", async () => {
  const spec = helpFixture(helpCommand);
  const v = values(await resolve(spec, ["help"], "", true));
  expect(v).toContain("build");
  expect(v).not.toContain("--help");
  expect(values(await resolve(spec, ["help"], "--h", true))).toEqual(["-h", "--help"]);
});

test("runtime: a help command with a copied action still completes names", async () => {
  const spec = helpFixture({ ...helpCommand, description: "Show help" });
  expect(values(await resolve(spec, ["help"], ""))).toContain("remote");
});

// ---------------------------------------------------------------------------
// The environment variable the shims set
// ---------------------------------------------------------------------------

test("every shim sets SHELL_COMPLETION_GENERATOR to the shell's name for the CLI", () => {
  expectIncludes(
    getCompletion(fixture, "bash"),
    `SHELL_COMPLETION_GENERATOR=bash "$bin" completion complete`,
  );
  expectIncludes(getCompletion(fixture, "zsh"), `SHELL_COMPLETION_GENERATOR=zsh "$bin" completion complete`);
  expectIncludes(getCompletion(fixture, "fish"), "set -lx SHELL_COMPLETION_GENERATOR fish");
  expectIncludes(getCompletion(fixture, "powershell"), "$env:SHELL_COMPLETION_GENERATOR = 'powershell'");
  expectIncludes(getCompletion(fixture, "nushell"), "$env.SHELL_COMPLETION_GENERATOR = 'nushell'");
});

/** Whether `command` runs on this machine. */
function hasShell(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `args` with `shell`, after writing the shim to `$DIR/shim` and a fake
 * `forge` to `$DIR` that offers SHELL_COMPLETION_GENERATOR's value as its only
 * candidate. The shell starts without the variable set.
 */
function runWithShim(shell: Shell & ("bash" | "fish" | "nushell"), args: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "clo4-cli-env-"));
  try {
    writeFileSync(join(dir, "forge"), `#!/bin/sh\nprintf '%s\\n' "\${SHELL_COMPLETION_GENERATOR:-unset}"\n`, {
      mode: 0o755,
    });
    writeFileSync(join(dir, "shim"), getCompletion(fixture, shell));
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${dir}:${process.env.PATH}` };
    delete env.SHELL_COMPLETION_GENERATOR;
    const command = shell === "nushell" ? "nu" : shell;
    return execFileSync(
      command,
      args.map((arg) => arg.replaceAll("$DIR", dir)),
      { env, encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Each of these prints the candidates, then the variable's value after completing.
test.skipIf(!hasShell("bash") || process.platform === "win32")("the bash shim sets the variable", () => {
  const script = [
    "source $DIR/shim",
    "COMP_WORDS=(forge ''); COMP_CWORD=1",
    "_forge_complete",
    'echo "${COMPREPLY[*]}"',
    'echo "${SHELL_COMPLETION_GENERATOR:-unset}"',
  ].join("\n");
  expect(runWithShim("bash", ["--norc", "-c", script])).toBe("bash\nunset\n");
});

test.skipIf(!hasShell("fish") || process.platform === "win32")("the fish shim sets the variable", () => {
  const script = [
    "source $DIR/shim",
    // `commandline` only works in an interactive shell, so this asks fish to
    // complete the line instead of calling the function.
    "complete -C 'forge '",
    "set -q SHELL_COMPLETION_GENERATOR; and echo $SHELL_COMPLETION_GENERATOR; or echo unset",
  ].join("\n");
  expect(runWithShim("fish", ["--no-config", "-c", script])).toBe("fish\nunset\n");
});

test.skipIf(!hasShell("nu") || process.platform === "win32")("the Nushell shim sets the variable", () => {
  const script = [
    "source $DIR/shim",
    "let complete = $env.config.completions.external.completer",
    "do $complete ['forge' ''] | get value | append ($env.SHELL_COMPLETION_GENERATOR? | default unset) | to json -r",
  ].join("\n");
  expect(JSON.parse(runWithShim("nushell", ["--no-config-file", "-c", script]))).toEqual([
    "nushell",
    "unset",
  ]);
});

// ---------------------------------------------------------------------------
// The lines `completion complete --shell` prints for each shell
// ---------------------------------------------------------------------------

const awkward = [
  { value: "plain" },
  { value: "http://example.com", description: "A URL: with colon" },
  { value: "a:b" },
  { value: "my file.txt", description: "A file\nsecond line" },
  { value: "it's" },
  { value: "$(touch x)" },
  { value: "back\\slash", description: "a \\ b" },
  { value: "Upper", description: "desc\twith\r\n  tabs" },
  // A tab or line break in a value can't fit on a line, so these are left out.
  { value: "tab\there" },
  { value: "line\nbreak" },
  { value: "carriage\rreturn" },
  { value: "" },
];

test("formatCandidates quotes values for bash and drops descriptions", () => {
  expect(formatCandidates(awkward, "bash", "")).toEqual([
    "plain",
    "http://example.com",
    "a:b",
    "my\\ file.txt",
    "it\\'s",
    "\\$\\(touch\\ x\\)",
    "back\\\\slash",
    "Upper",
  ]);
});

test("formatCandidates escapes every character bash treats specially", () => {
  const values = ["~home", "#tag", "!bang", "a*b?", "[x]", "{a,b}", "a;b|c&d", "<in>", '"q"', "`x`", "end "];
  expect(
    formatCandidates(
      values.map((value) => ({ value })),
      "bash",
      "",
    ),
  ).toEqual([
    "\\~home",
    "\\#tag",
    "\\!bang",
    "a\\*b\\?",
    "\\[x]",
    "\\{a,b\\}",
    "a\\;b\\|c\\&d",
    "\\<in\\>",
    '\\"q\\"',
    "\\`x\\`",
    "end\\ ",
  ]);
});

test("formatCandidates keeps the bash values whose quoted form starts with the word", () => {
  // Bash replaces the word as typed with the reply, so the CLI matches the
  // word against the quoted value, case and all.
  expect(formatCandidates(awkward, "bash", "my")).toEqual(["my\\ file.txt"]);
  expect(formatCandidates(awkward, "bash", "my\\ f")).toEqual(["my\\ file.txt"]);
  expect(formatCandidates(awkward, "bash", "\\$")).toEqual(["\\$\\(touch\\ x\\)"]);
  expect(formatCandidates(awkward, "bash", "U")).toEqual(["Upper"]);
  expect(formatCandidates(awkward, "bash", "u")).toEqual([]);
  expect(formatCandidates(awkward, "bash", "it'")).toEqual([]);
});

test("formatCandidates writes _describe lines for zsh with the value's colons escaped", () => {
  expect(formatCandidates(awkward, "zsh", "")).toEqual([
    "plain",
    "http\\://example.com:A URL: with colon",
    "a\\:b",
    "my file.txt:A file second line",
    "it's",
    "$(touch x)",
    "back\\\\slash:a \\\\ b",
    "Upper:desc with tabs",
  ]);
});

test("formatCandidates leaves filtering to zsh and fish", () => {
  for (const shell of ["zsh", "fish"] as const) {
    expect(formatCandidates(awkward, shell, "zzz")).toEqual(formatCandidates(awkward, shell, ""));
  }
});

test("formatCandidates writes fish lines with the value as it is", () => {
  expect(formatCandidates(awkward, "fish", "")).toEqual([
    "plain",
    "http://example.com\tA URL: with colon",
    "a:b",
    "my file.txt\tA file second line",
    "it's",
    "$(touch x)",
    "back\\slash\ta \\ b",
    "Upper\tdesc with tabs",
  ]);
});

test("formatCandidates writes the CompletionResult fields for PowerShell", () => {
  expect(formatCandidates(awkward, "powershell", "")).toEqual([
    "plain\tplain\tplain",
    "http://example.com\thttp://example.com\tA URL: with colon",
    "a:b\ta:b\ta:b",
    "'my file.txt'\tmy file.txt\tA file second line",
    "'it''s'\tit's\tit's",
    "'$(touch x)'\t$(touch x)\t$(touch x)",
    "back\\slash\tback\\slash\ta \\ b",
    "Upper\tUpper\tdesc with tabs",
  ]);
});

test("formatCandidates quotes the characters PowerShell reads as quotes", () => {
  const values = ["it\u2019s", "\u201cq\u201d", "a,b", "@x", "a{b}"];
  const texts = formatCandidates(
    values.map((value) => ({ value })),
    "powershell",
    "",
  ).map((line) => line.split("\t")[0]);
  expect(texts).toEqual(["'it\u2019\u2019s'", "'\u201cq\u201d'", "'a,b'", "'@x'", "'a{b}'"]);
});

test("formatCandidates writes Nushell lines with quoted values", () => {
  expect(formatCandidates(awkward, "nushell", "")).toEqual([
    "plain",
    "http://example.com\tA URL: with colon",
    "a:b",
    "'my file.txt'\tA file second line",
    `"it's"`,
    "'$(touch x)'",
    "back\\slash\ta \\ b",
    "Upper\tdesc with tabs",
  ]);
  const quotes = [{ value: `a'b"c` }, { value: "a'\\b" }, { value: "[x]" }];
  expect(formatCandidates(quotes, "nushell", "")).toEqual([`"a'b\\"c"`, `"a'\\\\b"`, "'[x]'"]);
});

test("formatCandidates keeps PowerShell and Nushell values that start with the word, ignoring case", () => {
  for (const shell of ["powershell", "nushell"] as const) {
    // The value is PowerShell's second field and Nushell's first.
    const values = (word: string) =>
      formatCandidates(awkward, shell, word).map((line) => line.split("\t")[shell === "powershell" ? 1 : 0]);
    expect(values("UP")).toEqual(["Upper"]);
    expect(values("my f")).toEqual([shell === "powershell" ? "my file.txt" : "'my file.txt'"]);
    expect(values("IT'")).toEqual([shell === "powershell" ? "it's" : `"it's"`]);
    expect(values("nothing")).toEqual([]);
    expect(values("")).toHaveLength(8);
  }
});

test("formatCandidates prints nothing for no candidates", () => {
  for (const shell of ["bash", "zsh", "fish", "powershell", "nushell"] as const) {
    expect(formatCandidates([], shell, "")).toEqual([]);
  }
});

const awkwardSpec: Spec = {
  name: "forge",
  subcommands: [
    completion,
    {
      name: "go",
      args: {
        name: "target",
        isVariadic: true,
        suggestions: [
          { name: "a:b", description: "colon: and\ttab" },
          { name: "two\nlines", description: "first\nsecond" },
          "end ",
        ],
      },
    },
  ],
};

test("complete subcommand prints candidates as they are without --shell", async () => {
  // These are the lines 3.1.0 printed, which the scripts it generated read.
  // The variable those scripts set doesn't change them.
  const previous = process.env.SHELL_COMPLETION_GENERATOR;
  process.env.SHELL_COMPLETION_GENERATOR = "bash";
  try {
    const result = await captureConsole(() => run(awkwardSpec, ["completion", "complete", "--", "go", ""]));
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("a:b\tcolon: and\ttab\ntwo\nlines\tfirst\nsecond\nend\n");
  } finally {
    if (previous === undefined) {
      delete process.env.SHELL_COMPLETION_GENERATOR;
    } else {
      process.env.SHELL_COMPLETION_GENERATOR = previous;
    }
  }
});

test("complete subcommand prints the shell's lines with --shell", async () => {
  const zsh = await captureConsole(() =>
    run(awkwardSpec, ["completion", "complete", "--shell", "zsh", "--", "go", ""]),
  );
  expect(zsh.code).toBe(0);
  expect(zsh.stdout).toBe("a\\:b:colon: and tab\nend \n");

  const bash = await captureConsole(() =>
    run(awkwardSpec, ["completion", "complete", "--shell", "bash", "--", "go", "e"]),
  );
  expect(bash.stdout).toBe("end\\ \n");

  const none = await captureConsole(() =>
    run(awkwardSpec, ["completion", "complete", "--shell", "bash", "--", "go", "zzz"]),
  );
  expect(none.code).toBe(0);
  expect(none.stdout).toBe("");
});

test("complete subcommand filters by an empty word with --empty-word", async () => {
  const result = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--shell", "powershell", "--empty-word", "--", "remote"]),
  );
  const values = result.stdout.split("\n").map((line) => line.split("\t")[1]);
  expect(values).toContain("remove");
  expect(values).toContain("rm");
});

test("complete subcommand rejects an unknown shell", async () => {
  const result = await captureConsole(() =>
    run(fixture, ["completion", "complete", "--shell", "tcsh", "--", ""]),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unsupported shell 'tcsh'/);
});

test("every shim asks for its own shell's lines", () => {
  expectIncludes(getCompletion(fixture, "bash"), "completion complete --shell bash --gate-options --");
  expectIncludes(getCompletion(fixture, "zsh"), "completion complete --shell zsh --");
  expectIncludes(getCompletion(fixture, "fish"), "completion complete --shell fish --gate-options --");
  expectIncludes(getCompletion(fixture, "powershell"), "'complete', '--shell', 'powershell'");
  expectIncludes(getCompletion(fixture, "nushell"), "completion complete --shell nushell --gate-options --");
});

// ---------------------------------------------------------------------------
// The scripts in real shells
// ---------------------------------------------------------------------------

/** Candidates that each shell's script has to get through whole. */
const tricky = [
  { value: "http://example.com", description: "A URL: with colon" },
  { value: "a:b" },
  { value: "my file.txt", description: "A file\nsecond line" },
  { value: "$(touch PWNED)" },
  { value: "back\\slash" },
  { value: "Upper" },
];

/**
 * Make a directory with the shell's script in `shim` and a fake `forge` in
 * `bin` that offers `tricky` for each of `words`.
 */
function trickyDir(shell: Shell, words: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), `clo4-cli-${shell}-`));
  mkdirSync(join(dir, "bin"));
  writeFakeCli(join(dir, "bin", "forge"), shell, tricky, words, join(dir, "args"));
  writeFileSync(join(dir, "shim"), getCompletion(fixture, shell));
  return dir;
}

const shellEnv = (dir: string): NodeJS.ProcessEnv => ({
  ...process.env,
  PATH: `${join(dir, "bin")}:${process.env.PATH}`,
});

test.skipIf(!hasShell("bash") || process.platform === "win32")(
  "the bash shim replies with each line as it is",
  () => {
    const dir = trickyDir("bash", ["", "my", "my\\ f", "\\$", "u"]);
    try {
      const script = [
        "source shim",
        't() { COMP_WORDS=("$@"); COMP_CWORD=$(( $# - 1 )); _forge_complete; printf "[%s]" "${COMPREPLY[@]}"; echo; }',
        "t forge go ''",
        "t forge go my",
        "t forge 'x y' go 'my\\ f'",
        "t forge go '\\$'",
        "t forge go u",
      ].join("\n");
      const output = execFileSync("bash", ["--norc", "-c", script], {
        cwd: dir,
        env: shellEnv(dir),
        encoding: "utf8",
      });
      expect(output.split("\n")).toEqual([
        "[http://example.com][a:b][my\\ file.txt][\\$\\(touch\\ PWNED\\)][back\\\\slash][Upper]",
        "[my\\ file.txt]",
        "[my\\ file.txt]",
        "[\\$\\(touch\\ PWNED\\)]",
        "[]",
        "",
      ]);
      // compgen -W would have run the command in the candidate.
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
      expect(readFileSync(join(dir, "args"), "utf8").split("\n")[2]).toBe(
        "<completion><complete><--shell><bash><--gate-options><--><x y><go><my\\ f>",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

test.skipIf(!hasShell("fish") || process.platform === "win32")(
  "the fish shim hands the lines to fish",
  () => {
    const dir = trickyDir("fish", ["", "MY", "a:"]);
    try {
      const script = [
        "source shim",
        "complete -C 'forge go '",
        "echo ---",
        "complete -C 'forge go MY'",
        "echo ---",
        "complete -C 'forge go a:'",
      ].join("\n");
      const output = execFileSync("fish", ["--no-config", "-c", script], {
        cwd: dir,
        env: shellEnv(dir),
        encoding: "utf8",
      });
      const [all, my, colon] = output.split("---\n").map((part) => part.split("\n").filter(Boolean));
      expect(all.sort()).toEqual(
        [
          "http://example.com\tA URL: with colon",
          "a:b",
          "my file.txt\tA file second line",
          "$(touch PWNED)",
          "back\\slash",
          "Upper",
        ].sort(),
      );
      // Fish ignores case when it matches.
      expect(my).toEqual(["my file.txt\tA file second line"]);
      expect(colon).toEqual(["a:b"]);
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

/**
 * Sourced by an interactive zsh. A wrapper around compadd prints each match
 * and display string that `_describe` hands to zsh. Tab prints the command
 * line once it has completed.
 */
const zshSetup = [
  "PS1=",
  "RPS1=",
  "fpath=($DIR/fpath $fpath)",
  "autoload -Uz compinit",
  "compinit -u -D",
  "compadd() {",
  // A call with -O, -A or -D only asks which words match.
  '  if [[ ${@[1,(i)(-|--)]} == *-(O|A|D)\\ * ]]; then builtin compadd "$@"; return; fi',
  "  local -a __matches __display",
  '  builtin compadd -O __matches "$@"',
  "  local -i __i=${@[(i)-d]}",
  '  (( __i < $# )) && __display=( "${(@P)argv[__i+1]}" )',
  "  local __m",
  `  for __m in $__matches; do print -r -- $'\\n'"MATCH<$__m>"; done`,
  `  for __m in $__display; do print -r -- $'\\n'"DISPLAY<$__m>"; done`,
  '  builtin compadd "$@"',
  "}",
  `_tab() { zle complete-word; print -r -- $'\\n'"LINE<$BUFFER>"; print -r -- "DO""NE" }`,
  "zle -N _tab",
  "bindkey '^I' _tab",
  'print -r -- "REA""DY"',
].join("\n");

/**
 * Types each line and Tab into an interactive zsh in a pseudo-terminal, and
 * prints what the setup printed.
 */
const zshDriver = [
  "zmodload zsh/zpty || exit 2",
  "export DIR=$1",
  "shift",
  "local line out",
  "zpty z zsh -f -i",
  'zpty -w z "source $DIR/setup.zsh"',
  "zpty -r z out '*READY*'",
  'for line in "$@"; do',
  // Ctrl-U clears the line the last completion left.
  `  zpty -w -n z $'\\x15'"$line"$'\\t'`,
  "  zpty -r z out '*DONE*'",
  '  print -r -- "--- $line"',
  `  print -r -- "$out" | tr -d '\\r' | grep -ao 'MATCH<[^>]*>\\|DISPLAY<[^>]*>\\|LINE<.*>'`,
  "done",
  "zpty -d z",
].join("\n");

test.skipIf(!hasShell("zsh") || process.platform === "win32")(
  "the zsh shim hands zsh each value whole, colons included",
  () => {
    const dir = trickyDir("zsh", ["", "a:", "ht", "my f", "back", "$("]);
    try {
      // The script goes on fpath as _forge, the way the README installs it.
      mkdirSync(join(dir, "fpath"));
      writeFileSync(join(dir, "fpath", "_forge"), getCompletion(fixture, "zsh"));
      writeFileSync(join(dir, "setup.zsh"), zshSetup);
      writeFileSync(join(dir, "drive.zsh"), zshDriver);
      const lines = [
        "forge go ",
        "forge go a:",
        "forge go ht",
        "forge 'x y' go 'my f",
        "forge go back",
        "forge go \\$(",
      ];
      const output = execFileSync("zsh", ["-f", join(dir, "drive.zsh"), dir, ...lines], {
        cwd: dir,
        env: shellEnv(dir),
        encoding: "utf8",
        timeout: 30_000,
      });
      const results = new Map(
        output
          .split("--- ")
          .filter(Boolean)
          .map((part) => {
            const [line, ...rest] = part.split("\n");
            return [line, rest.filter(Boolean)];
          }),
      );
      const all = results.get("forge go ") ?? [];
      // Zsh can call compadd more than once for a Tab.
      expect([...new Set(all.filter((line) => line.startsWith("MATCH<")))].sort()).toEqual(
        [
          "MATCH<http://example.com>",
          "MATCH<a:b>",
          "MATCH<my file.txt>",
          "MATCH<$(touch PWNED)>",
          "MATCH<back\\slash>",
          "MATCH<Upper>",
        ].sort(),
      );
      expect(all).toContainEqual(
        expect.stringMatching(/^DISPLAY<http:\/\/example\.com +-- A URL: with colon>$/),
      );
      expect(all).toContainEqual(expect.stringMatching(/^DISPLAY<my file\.txt +-- A file second line>$/));
      // Zsh quotes what it inserts.
      expect(results.get("forge go a:")).toContain("LINE<forge go a:b >");
      expect(results.get("forge go ht")).toContain("LINE<forge go http://example.com >");
      expect(results.get("forge 'x y' go 'my f")).toContain("LINE<forge 'x y' go 'my file.txt' >");
      expect(results.get("forge go back")).toContain("LINE<forge go back\\\\slash >");
      expect(results.get("forge go \\$(")).toContain("LINE<forge go \\$\\(touch\\ PWNED\\) >");
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
      // The words reach the CLI one by one, without their quotes.
      expect(readFileSync(join(dir, "args"), "utf8").split("\n")).toEqual([
        "<completion><complete><--shell><zsh><--><go><>",
        "<completion><complete><--shell><zsh><--><go><a:>",
        "<completion><complete><--shell><zsh><--><go><ht>",
        "<completion><complete><--shell><zsh><--><x y><go><my f>",
        "<completion><complete><--shell><zsh><--><go><back>",
        "<completion><complete><--shell><zsh><--><go><$(>",
        "",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
  30_000,
);
