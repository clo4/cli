import { expect, test } from "vitest";

import { help, helpCommand, printError, run } from "../src/index.js";
import type { ActionInit, Spec } from "../src/types.js";
import { captureConsole } from "./helpers.js";

test("run: return 1 with no action", async () => {
  await expect(run({ name: "test" }, [])).resolves.toBe(1);
});

test("run: return action result", async () => {
  for (const result of [0, 1, 2, 3]) {
    await expect(run({ name: "test", action: () => result }, [])).resolves.toBe(result);
  }
});

test("run: use deepest subcommand", async () => {
  const out = await run(
    {
      name: "test",
      action: () => 0,
      subcommands: [
        {
          name: "1",
          action: () => 1,
          subcommands: [
            {
              name: "2",
              action: () => 2,
            },
          ],
        },
      ],
    },
    ["1", "2"],
  );
  expect(out).toBe(2);
});

test("run: prefer final option action", async () => {
  // run-fig preferred the first option action. @clo4/cli intentionally uses
  // the final parsed option action so later helpers can override earlier ones.
  const out = await run(
    {
      name: "test",
      action: () => 0,
      options: [
        { name: "--alpha", isPersistent: true, action: () => 123 },
        { name: "--beta", isPersistent: true, action: () => 234 },
      ],
      subcommands: [
        {
          name: "1",
          action: () => 1,
          subcommands: [
            {
              name: "2",
              action: () => 2,
              options: [{ name: "--test", action: () => 210 }],
            },
          ],
        },
      ],
    },
    ["1", "--beta", "2", "--test", "--alpha"],
  );
  expect(out).toBe(123);
});

test("run: executes command actions and exposes parsed string values", async () => {
  const spec: Spec = {
    name: "demo",
    args: { name: "input" },
    options: [{ name: "--suffix", args: { name: "text" } }],
    action({ args, options }: ActionInit) {
      const input = args[0];
      console.log(`${input}${options.get("--suffix") ?? ""}`);
    },
  };

  const result = await captureConsole(() => run(spec, ["file", "--suffix", ".out"]));

  expect(result.code).toBe(0);
  expect(result.stdout).toBe("file.out\n");
  expect(result.stderr).toBe("");
});

test("run: option actions bypass missing command inputs", async () => {
  const spec: Spec = {
    name: "demo",
    args: { name: "required" },
    options: [
      { name: "--required", isRequired: true },
      { name: "--version", action: () => console.log("1.0.0") },
      help,
    ],
    action() {
      throw new Error("command action should not run");
    },
  };

  const version = await captureConsole(() => run(spec, ["--version"]));
  expect(version.code).toBe(0);
  expect(version.stdout).toBe("1.0.0\n");
  expect(version.stderr).toBe("");

  const helpResult = await captureConsole(() => run(spec, ["--help"]));
  expect(helpResult.code).toBe(0);
  expect(helpResult.stdout).toMatch(/Usage:\n  demo --required \[flags\] <required>/);
  expect(helpResult.stderr).toBe("");

  const missingRequiredOption = await captureConsole(() => run(spec, ["file"]));
  expect(missingRequiredOption.code).toBe(1);
  expect(missingRequiredOption.stderr).toMatch(/Option --required is required/);
});

test("run: reports parse errors with help", async () => {
  const result = await captureConsole(() =>
    run({ name: "demo", options: [{ name: "--known" }] }, ["--missing"]),
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/looks like a flag/);
  expect(result.stderr).toMatch(/Did you mean '--known'/);
});

test("run: awaits async actions and returns the resolved code", async () => {
  const out = await run(
    {
      name: "demo",
      action: async () => {
        await Promise.resolve();
        return 2;
      },
    },
    [],
  );
  expect(out).toBe(2);
});

test("run: async action that rejects returns 1 and prints the error", async () => {
  const result = await captureConsole(() =>
    run(
      {
        name: "demo",
        action: async () => {
          await Promise.resolve();
          throw new Error("kaboom");
        },
      },
      [],
    ),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Error: kaboom/);
});

test("printError formats with an 'Error:' prefix on stderr", async () => {
  const result = await captureConsole(() => {
    printError("something went wrong");
  });
  expect(result.stderr).toBe("Error: something went wrong\n");
});

test("run: helpCommand prints help for its parent and siblings", async () => {
  const spec: Spec = {
    name: "demo",
    description: "demo cli",
    subcommands: [{ name: "build", description: "build the thing", action: () => {} }, helpCommand],
  };

  const root = await captureConsole(() => run(spec, ["help"]));
  expect(root.code).toBe(0);
  expect(root.stdout).toMatch(/Commands:/);
  expect(root.stdout).toMatch(/build/);

  const sibling = await captureConsole(() => run(spec, ["help", "build"]));
  expect(sibling.code).toBe(0);
  expect(sibling.stdout).toMatch(/build the thing/);

  const unknown = await captureConsole(() => run(spec, ["help", "bld"]));
  expect(unknown.code).toBe(1);
  expect(unknown.stderr).toMatch(/no subcommand named 'bld'/);
  expect(unknown.stderr).toMatch(/Did you mean 'build'/);
});

test("run: ambiguous unique-prefix command reports the candidates", async () => {
  const spec: Spec = {
    name: "demo",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "start", action: () => {} },
      { name: "stop", action: () => {} },
    ],
  };
  const result = await captureConsole(() => run(spec, ["st"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Ambiguous command 'st'/);
  expect(result.stderr).toMatch(/start, stop/);
});
