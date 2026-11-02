import { expect, test } from "vitest";

import { help, run } from "../src/index.js";
import type { Spec } from "../src/types.js";
import { captureConsole } from "./helpers.js";

/**
 * A realistic, deeply nested CLI exercised by the end-to-end tests below: a fake
 * build tool "forge" with a global persistent+repeatable option, a subcommand that
 * requires a subcommand (`remote`), mid-tree positional args, variadic args, and
 * the full range of option constraints the parser supports (required, dependsOn,
 * exclusiveOn, requiresSeparator, repeatable-with-limit, aliases).
 */
function forge(): Spec {
  return {
    name: "forge",
    description: "Build orchestrator.",
    options: [
      help,
      {
        name: ["-v", "--verbose"],
        description: "Increase verbosity.",
        isPersistent: true,
        isRepeatable: true,
      },
    ],
    subcommands: [
      {
        name: ["remote", "r"],
        description: "Manage remotes.",
        requiresSubcommand: true,
        subcommands: [
          {
            name: "add",
            description: "Add a remote.",
            args: [{ name: "name" }, { name: "url", isOptional: true }],
            options: [
              { name: "--force", description: "Overwrite an existing remote." },
              {
                name: "--tag",
                description: "Attach a tag.",
                args: { name: "tag" },
                requiresSeparator: "=",
              },
            ],
            action({ args, options }) {
              console.log(
                `add:${args[0]}:${args[1] ?? "-"}:force=${options.has("--force")}:tag=${
                  options.get("--tag") ?? "-"
                }:v${options.count("-v")}`,
              );
            },
          },
          {
            name: "remove",
            description: "Remove a remote.",
            args: { name: "name" },
            action({ args }) {
              console.log(`remove:${args[0]}`);
            },
          },
        ],
      },
      {
        name: ["build", "b"],
        description: "Build inputs.",
        args: { name: "inputs", isVariadic: true },
        options: [
          { name: "--out", description: "Output dir.", args: { name: "dir" }, isRequired: true },
          {
            name: "--mode",
            description: "Build mode.",
            args: { name: "mode" },
            dependsOn: ["--out"],
          },
          { name: "--watch", description: "Watch files." },
          { name: "--quiet", description: "Suppress output.", exclusiveOn: ["--watch"] },
          { name: "--retry", description: "Retry on failure.", isRepeatable: 2 },
        ],
        action({ args, options }) {
          console.log(
            `build:[${args.join(",")}]:out=${options.get("--out")}:mode=${
              options.get("--mode") ?? "-"
            }:watch=${options.has("--watch")}:retry=${options.count("--retry")}:v${options.count("-v")}`,
          );
        },
      },
    ],
  };
}

// --- Dispatch & nesting -----------------------------------------------------

test("complex: dispatches a deeply nested subcommand with mid-tree args", async () => {
  const result = await captureConsole(() =>
    run(forge(), ["remote", "add", "origin", "https://x", "--force"]),
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("add:origin:https://x:force=true:tag=-:v0\n");
});

test("complex: optional positional arg can be omitted", async () => {
  const result = await captureConsole(() => run(forge(), ["remote", "add", "origin"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("add:origin:-:force=false:tag=-:v0\n");
});

test("complex: subcommand aliases resolve to the same action", async () => {
  const full = await captureConsole(() => run(forge(), ["remote", "remove", "origin"]));
  const alias = await captureConsole(() => run(forge(), ["r", "remove", "origin"]));
  expect(full.code).toBe(0);
  expect(full.stdout).toBe("remove:origin\n");
  expect(alias.stdout).toBe(full.stdout);
});

test("complex: command alias resolves to the same action", async () => {
  const full = await captureConsole(() => run(forge(), ["build", "main", "--out", "dist"]));
  const alias = await captureConsole(() => run(forge(), ["b", "main", "--out", "dist"]));
  expect(full.code).toBe(0);
  expect(full.stdout).toBe("build:[main]:out=dist:mode=-:watch=false:retry=0:v0\n");
  expect(alias.stdout).toBe(full.stdout);
});

// --- requiresSubcommand -----------------------------------------------------

test("complex: requiresSubcommand prints usage and succeeds with no subcommand", async () => {
  const result = await captureConsole(() => run(forge(), ["remote"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/Usage:/);
  expect(result.stdout).toMatch(/forge remote/);
});

test("complex: requiresSubcommand reports an unknown subcommand", async () => {
  const result = await captureConsole(() => run(forge(), ["remote", "bogus"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unknown command 'bogus'/);
});

// --- Variadic args + options --------------------------------------------------

test("complex: variadic args interspersed with a option", async () => {
  const result = await captureConsole(() =>
    run(forge(), ["build", "a", "b", "--out", "dist", "c"]),
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("build:[a,b,c]:out=dist:mode=-:watch=false:retry=0:v0\n");
});

// --- Persistent + repeatable options -----------------------------------------

test("complex: persistent repeatable option counts across nesting (separate + chained)", async () => {
  const separate = await captureConsole(() =>
    run(forge(), ["remote", "add", "origin", "-v", "-v"]),
  );
  expect(separate.code).toBe(0);
  expect(separate.stdout).toBe("add:origin:-:force=false:tag=-:v2\n");

  const chained = await captureConsole(() => run(forge(), ["remote", "add", "origin", "-vvv"]));
  expect(chained.code).toBe(0);
  expect(chained.stdout).toBe("add:origin:-:force=false:tag=-:v3\n");
});

// --- requiresSeparator ------------------------------------------------------

test("complex: requiresSeparator accepts an attached arg", async () => {
  const result = await captureConsole(() =>
    run(forge(), ["remote", "add", "origin", "--tag=stable"]),
  );
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("add:origin:-:force=false:tag=stable:v0\n");
});

test("complex: requiresSeparator rejects a detached arg", async () => {
  const result = await captureConsole(() =>
    run(forge(), ["remote", "add", "origin", "--tag", "stable"]),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/argument/);
});

// --- Option constraints -------------------------------------------------------

test("complex: missing required option fails", async () => {
  const result = await captureConsole(() => run(forge(), ["build", "main"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Option --out is required/);
});

test("complex: dependsOn is enforced", async () => {
  const result = await captureConsole(() => run(forge(), ["build", "main", "--mode", "dev"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/--mode requires --out/);
});

test("complex: exclusiveOn is enforced", async () => {
  const result = await captureConsole(() =>
    run(forge(), ["build", "main", "--out", "dist", "--watch", "--quiet"]),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/--quiet can't be used together with --watch/);
});

test("complex: repeatable option honors its limit", async () => {
  const ok = await captureConsole(() =>
    run(forge(), ["build", "main", "--out", "dist", "--retry", "--retry"]),
  );
  expect(ok.code).toBe(0);
  expect(ok.stdout).toMatch(/retry=2/);

  const tooMany = await captureConsole(() =>
    run(forge(), ["build", "main", "--out", "dist", "--retry", "--retry", "--retry"]),
  );
  expect(tooMany.code).toBe(1);
  expect(tooMany.stderr).toMatch(/Too many repetitions/);
});

// --- Help precedence at depth ----------------------------------------------

test("complex: --help on a nested command bypasses required options", async () => {
  const result = await captureConsole(() => run(forge(), ["build", "--help"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/Usage:\n {2}forge build/);
  expect(result.stderr).toBe("");
});

// --- parserDirectives -------------------------------------------------------

test("complex: subcommandsMatchUniquePrefix dispatches on a unique prefix", async () => {
  const spec: Spec = {
    name: "git",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "status", action: () => console.log("status") },
      { name: "stash", action: () => console.log("stash") },
      { name: "commit", action: () => console.log("commit") },
    ],
  };
  const unique = await captureConsole(() => run(spec, ["co"]));
  expect(unique.code).toBe(0);
  expect(unique.stdout).toBe("commit\n");
});

test("complex: optionsMustPrecedeArguments treats later option-like tokens as args", async () => {
  const spec: Spec = {
    name: "echo",
    parserDirectives: { optionsMustPrecedeArguments: true },
    args: { name: "items", isVariadic: true },
    options: [{ name: "--watch" }],
    action({ args, options }) {
      console.log(`args=[${args.join(",")}] watch=${options.has("--watch")}`);
    },
  };
  const result = await captureConsole(() => run(spec, ["first", "--watch"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toBe("args=[first,--watch] watch=false\n");
});

// --- Exit codes -------------------------------------------------------------

test("complex: action exit codes are returned and clamped to 0-255", async () => {
  await expect(run({ name: "x", action: () => 42 }, [])).resolves.toBe(42);
  await expect(run({ name: "x", action: () => 999 }, [])).resolves.toBe(255);
  await expect(run({ name: "x", action: () => -5 }, [])).resolves.toBe(0);
});

// --- Exit-path hardening (non-Error throws) ---------------------------------

test("complex: a thrown non-Error value still exits 1 with a diagnostic", async () => {
  const stringThrow = await captureConsole(() =>
    run(
      {
        name: "x",
        action: () => {
          throw "boom";
        },
      },
      [],
    ),
  );
  expect(stringThrow.code).toBe(1);
  expect(stringThrow.stderr).toMatch(/Error: boom/);

  const objectThrow = await captureConsole(() =>
    run(
      {
        name: "x",
        action: () => {
          throw { code: "E_NOPE" };
        },
      },
      [],
    ),
  );
  expect(objectThrow.code).toBe(1);
  expect(objectThrow.stderr).toMatch(/Error:/);
});
