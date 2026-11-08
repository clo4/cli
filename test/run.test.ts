import { expect, test } from "vitest";

import { help, helpCommand, printError, run } from "../src/index.js";
import type { ActionInit, Spec, Subcommand } from "../src/types.js";
import { captureConsole } from "./helpers.js";

test("run: a spec without an action prints its help", async () => {
  const result = await captureConsole(() => run({ name: "test", description: "DESCRIPTION" }, []));
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/^DESCRIPTION\n\nUsage:\n {2}test/);
  expect(result.stderr).toBe("");
});

test("run: a subcommand without an action prints its own help instead of running its parent's action", async () => {
  const spec: Spec = {
    name: "test",
    action() {
      throw new Error("the root action should not run");
    },
    subcommands: [{ name: "sub", description: "SUB_DESCRIPTION" }],
  };
  const result = await captureConsole(() => run(spec, ["sub"]));
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/^SUB_DESCRIPTION\n\nUsage:\n {2}test sub/);
  expect(result.stderr).toBe("");
});

test("run: return action result", async () => {
  for (const result of [0, 1, 2, 3]) {
    await expect(run({ name: "test", action: () => result }, [])).resolves.toBe(result);
  }
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
    run({ name: "demo", options: [{ name: "--known" }] }, ["--konwn"]),
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/looks like a flag/);
  expect(result.stderr).toMatch(/Did you mean '--known'/);
});

test("run: doesn't suggest an unrelated option", async () => {
  const result = await captureConsole(() =>
    run({ name: "demo", options: [{ name: "--known" }] }, ["--missing"]),
  );

  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/looks like a flag/);
  expect(result.stderr).not.toMatch(/Did you mean/);
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
  expect(unknown.stderr).toMatch(/^Error: Unknown command 'bld'/);
  expect(unknown.stderr).toMatch(/Did you mean 'build'/);
});

test("run: helpCommand matches a unique prefix like the parser does", async () => {
  const spec: Spec = {
    name: "demo",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "build", description: "build the thing", action: () => {} },
      { name: "bundle", description: "bundle the thing", action: () => {} },
      helpCommand,
    ],
  };
  const unique = await captureConsole(() => run(spec, ["help", "bui"]));
  expect(unique.code).toBe(0);
  expect(unique.stdout).toMatch(/build the thing/);

  const ambiguous = await captureConsole(() => run(spec, ["help", "bu"]));
  expect(ambiguous.code).toBe(1);
  expect(ambiguous.stderr).toMatch(/^Error: Ambiguous command 'bu', could be: build, bundle/);
});

test("run: helpCommand reads a path of command names", async () => {
  const c: Subcommand = { name: "c", description: "the c command", args: { name: "file" }, action: () => {} };
  const spec: Spec = {
    name: "demo",
    subcommands: [{ name: "a", subcommands: [{ name: "b", subcommands: [c] }] }, helpCommand],
  };

  const nested = await captureConsole(() => run(spec, ["help", "a", "b", "c"]));
  expect(nested.code).toBe(0);
  expect(nested.stdout).toMatch(/the c command/);
  expect(nested.stdout).toMatch(/Usage:\n {2}demo a b c <file>\n/);

  // `help help` is help for `help`.
  const helpHelp = await captureConsole(() => run(spec, ["help", "help"]));
  expect(helpHelp.stdout).toMatch(/demo help \[command\]\.\.\./);
});

test("run: helpCommand stops at an argument and reports an unknown command", async () => {
  const spec: Spec = {
    name: "demo",
    subcommands: [
      {
        name: "completion",
        description: "print a script",
        args: { name: "shell", isOptional: true },
        subcommands: [{ name: "complete", hidden: true, action: () => {} }],
        action: () => {},
      },
      { name: "version", description: "print the version", action: () => {} },
      { name: "remote", subcommands: [{ name: "add", action: () => {} }] },
      helpCommand,
    ],
  };

  // A command that takes arguments, or that has no subcommands, ends the names.
  const shell = await captureConsole(() => run(spec, ["help", "completion", "nushell", "extra"]));
  expect(shell.code).toBe(0);
  expect(shell.stdout).toMatch(/print a script/);
  const leaf = await captureConsole(() => run(spec, ["help", "version", "extra"]));
  expect(leaf.code).toBe(0);
  expect(leaf.stdout).toMatch(/print the version/);

  // Where only a subcommand can go, the error shows that command's usage.
  const unknown = await captureConsole(() => run(spec, ["help", "remote", "ad"]));
  expect(unknown.code).toBe(1);
  expect(unknown.stderr).toMatch(/^Error: Unknown command 'ad'/);
  expect(unknown.stderr).toMatch(/Did you mean 'add'/);
  expect(unknown.stderr).toMatch(/Usage:\n {2}demo remote\n/);
});

test("run: a persistent helpCommand works from any command", async () => {
  const c: Subcommand = { name: "c", description: "the c command", args: { name: "file" }, action: () => {} };
  const spec: Spec = {
    name: "demo",
    subcommands: [
      { name: "a", subcommands: [{ name: "b", subcommands: [c] }] },
      { ...helpCommand, isPersistent: true },
    ],
  };

  const before = await captureConsole(() => run(spec, ["help", "a", "b", "c"]));
  const after = await captureConsole(() => run(spec, ["a", "b", "c", "help"]));
  const middle = await captureConsole(() => run(spec, ["a", "help", "b", "c"]));
  expect(before.code).toBe(0);
  expect(before.stdout).toMatch(/the c command/);
  expect(after).toEqual(before);
  expect(middle).toEqual(before);

  // A name that leads back to `help` is the same as ending the names there.
  expect(await captureConsole(() => run(spec, ["help", "a", "b", "c", "help"]))).toEqual(before);
  expect(await captureConsole(() => run(spec, ["help", "a", "help", "b"]))).toEqual(
    await captureConsole(() => run(spec, ["help", "a"])),
  );
});

test("run: helpCommand isn't persistent", async () => {
  const seen: string[][] = [];
  const spec: Spec = {
    name: "demo",
    subcommands: [
      { name: "open", args: { name: "file" }, action: ({ args }) => void seen.push(args) },
      helpCommand,
    ],
  };
  await captureConsole(() => run(spec, ["open", "help"]));
  expect(seen).toEqual([["help"]]);
});

test("run: an inherited subcommand gives way to arguments and own subcommands", async () => {
  const seen: string[][] = [];
  const spec: Spec = {
    name: "demo",
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      {
        name: "open",
        description: "open files",
        args: { name: "file", isVariadic: true },
        action: ({ args }) => void seen.push(args),
      },
      { name: "group", subcommands: [{ name: "help", action: () => void seen.push(["own help"]) }] },
      { ...helpCommand, isPersistent: true },
    ],
  };

  // After an argument, and after `--`, "help" is an argument.
  await captureConsole(() => run(spec, ["open", "x", "help"]));
  await captureConsole(() => run(spec, ["open", "--", "help"]));
  // An inherited command only matches its exact name.
  await captureConsole(() => run(spec, ["open", "he"]));
  // A command's own subcommand wins the name.
  await captureConsole(() => run(spec, ["group", "help"]));
  expect(seen).toEqual([["x", "help"], ["help"], ["he"], ["own help"]]);

  const help = await captureConsole(() => run(spec, ["open", "help"]));
  expect(help.stdout).toMatch(/open files/);
  // Help only lists an inherited command under the command that defines it.
  expect(help.stdout).not.toMatch(/Commands:/);
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

test("run: a command that matches no prefix is unknown in prefix mode", async () => {
  const spec: Spec = {
    name: "demo",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "start", action: () => {} },
      { name: "stop", action: () => {} },
    ],
  };
  const result = await captureConsole(() => run(spec, ["stp"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/Unknown command 'stp'/);
  expect(result.stderr).toMatch(/Did you mean 'stop'/);
});

test("run: an empty command is reported as empty", async () => {
  const spec: Spec = {
    name: "demo",
    requiresSubcommand: true,
    subcommands: [{ name: "start", action: () => {} }],
  };
  const result = await captureConsole(() => run(spec, [""]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(
    /^Error: Expected a command, but the value was empty\n\nUsage:\n {2}demo <command>/,
  );
});

test("run: an unknown option in a subcommand shows that subcommand's help", async () => {
  const spec: Spec = {
    name: "demo",
    options: [{ name: "--verbose", isPersistent: true, description: "Talk more" }],
    subcommands: [{ name: "build", description: "BUILD_DESCRIPTION", action: () => {} }],
  };
  const result = await captureConsole(() => run(spec, ["build", "--verbos"]));
  expect(result.code).toBe(1);
  expect(result.stderr).toMatch(/^Error: "--verbos" looks like a flag, but is unknown in this context\n\n/);
  expect(result.stderr).toMatch(/Did you mean '--verbose'/);
  expect(result.stderr).toMatch(/Usage:\n {2}demo build \[flags\]/);
  // Help for an error leaves out the description.
  expect(result.stderr).not.toMatch(/BUILD_DESCRIPTION/);
});

test("run: an action receives the index of '--' among the arguments", async () => {
  let init: ActionInit | undefined;
  const spec: Spec = {
    name: "demo",
    args: { isVariadic: true },
    action(received) {
      init = received;
    },
  };
  await run(spec, ["a", "--", "b", "c"]);
  expect(init?.args).toEqual(["a", "b", "c"]);
  expect(init?.argSeparatorIndex).toBe(1);
  await run(spec, ["a"]);
  expect(init?.argSeparatorIndex).toBe(-1);
});

test("run: a hidden command doesn't make a prefix ambiguous", async () => {
  let ran = "";
  const spec: Spec = {
    name: "demo",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "build", action: () => void (ran = "build") },
      { name: "bundle", hidden: true, action: () => void (ran = "bundle") },
    ],
  };
  const result = await captureConsole(() => run(spec, ["b"]));
  expect(result.stderr).toBe("");
  expect(ran).toBe("build");
});

test("run: a command's name after '--' is an argument, so it isn't ambiguous", async () => {
  const spec: Spec = {
    name: "demo",
    requiresSubcommand: true,
    parserDirectives: { subcommandsMatchUniquePrefix: true },
    subcommands: [
      { name: "build", action: () => {} },
      { name: "bundle", action: () => {} },
    ],
  };
  for (const command of ["build", "bui"]) {
    const result = await captureConsole(() => run(spec, ["--", command]));
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(new RegExp(`^Error: Too many arguments, "${command}" was unexpected`));
  }
});
