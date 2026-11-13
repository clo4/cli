import { expect, test, vi } from "vitest";

import { completeRuntime } from "../src/completion.js";
import { getHelp } from "../src/help.js";
import type { HelpConfig } from "../src/help.js";
import { help, helpCommand } from "../src/index.js";
import { parse, parseOrWait, readNext, readNextOrWait, readToken } from "../src/parse.js";
import type { ParseResult } from "../src/parse.js";
import { loadAll } from "../src/scope.js";
import * as Testing from "../src/testing.js";
import type { ActionInit, CommandBody, NonEmptyArray, Spec, Subcommand } from "../src/types.js";
import { TIMEOUT, caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator } from "./fuzz/generate.js";
import { difference, nextDifference } from "./fuzz/snapshot.js";
import type { Outcome } from "./fuzz/snapshot.js";
import { captureConsole, run } from "./helpers.js";

/** A CLI with two groups whose bodies load, and a count of the loads of each. */
function lazyCli(wrap: (body: CommandBody) => CommandBody | Promise<CommandBody>) {
  const loads = { remote: 0, add: 0, config: 0 };
  const ran: string[] = [];
  const spec: Spec = {
    name: "forge",
    options: [help, { name: "--verbose", isPersistent: true }],
    subcommands: [
      helpCommand,
      {
        name: ["remote", "r"],
        description: "Manage remotes.",
        loadSpec() {
          loads.remote++;
          return wrap({
            requiresSubcommand: true,
            subcommands: [
              {
                name: "add",
                description: "Add a remote.",
                loadSpec() {
                  loads.add++;
                  return wrap({
                    args: { name: "name" },
                    options: [{ name: "--force", description: "Overwrite." }],
                    action({ args, options }) {
                      ran.push(`add:${args[0]}:${options.has("--force")}:${options.has("--verbose")}`);
                    },
                  });
                },
              },
              { name: "list", description: "List remotes.", action: () => void ran.push("list") },
            ],
          });
        },
      },
      {
        name: "config",
        description: "Manage configuration.",
        loadSpec() {
          loads.config++;
          return wrap({ args: { name: "key" }, action: ({ args }) => void ran.push(`config:${args[0]}`) });
        },
      },
    ],
  };
  return { spec, loads, ran };
}

const kinds: [string, (body: CommandBody) => CommandBody | Promise<CommandBody>][] = [
  ["a body", (body) => body],
  ["a promise", (body) => Promise.resolve(body)],
];

for (const [kind, wrap] of kinds) {
  test(`loadSpec returning ${kind}: run loads the commands on the line and no others`, async () => {
    const { spec, loads, ran } = lazyCli(wrap);
    await expect(run(spec, ["--verbose", "r", "add", "origin", "--force"])).resolves.toBe(0);
    expect(ran).toEqual(["add:origin:true:true"]);
    expect(loads).toEqual({ remote: 1, add: 1, config: 0 });
  });

  test(`loadSpec returning ${kind}: a command is loaded once`, async () => {
    const { spec, loads, ran } = lazyCli(wrap);
    await run(spec, ["remote", "list"]);
    await run(spec, ["remote", "add", "x"]);
    expect(ran).toEqual(["list", "add:x:false:false"]);
    expect(loads).toEqual({ remote: 1, add: 1, config: 0 });
  });

  test(`loadSpec returning ${kind}: a usage error after a load shows the loaded command`, async () => {
    const { spec } = lazyCli(wrap);
    const result = await captureConsole(() => run(spec, ["remote", "add", "x", "--forec"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('"--forec" looks like a flag');
    expect(result.stderr).toContain("Did you mean '--force'?");
    expect(result.stderr).toContain("forge remote add [flags] <name>");
  });

  test(`loadSpec returning ${kind}: root help lists the commands without loading them`, async () => {
    const { spec, loads } = lazyCli(wrap);
    const result = await captureConsole(() => run(spec, ["--help"]));
    expect(result.stdout).toContain("r, remote  Manage remotes.");
    expect(result.stdout).toContain("config     Manage configuration.");
    expect(loads).toEqual({ remote: 0, add: 0, config: 0 });
  });

  test(`loadSpec returning ${kind}: the help option and the help command load the path`, async () => {
    for (const line of [
      ["remote", "--help"],
      ["help", "remote"],
    ]) {
      const { spec, loads } = lazyCli(wrap);
      const result = await captureConsole(() => run(spec, line));
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("add   Add a remote.");
      expect(loads).toEqual({ remote: 1, add: 0, config: 0 });
    }
    const { spec } = lazyCli(wrap);
    const nested = await captureConsole(() => run(spec, ["help", "remote", "add"]));
    expect(nested.stdout).toContain("--force     Overwrite.");
    const unknown = await captureConsole(() => run(spec, ["help", "remote", "ad"]));
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain("Unknown command 'ad'");
  });

  test(`loadSpec returning ${kind}: completion loads the commands before the word`, async () => {
    const { spec, loads } = lazyCli(wrap);
    const names = async (before: string[], partial: string) =>
      (await completeRuntime({ spec, before, partial, gateOptions: true })).map(({ value }) => value);
    // The word names a command, but nothing follows it, so it isn't loaded.
    expect(await names([], "remote")).toContain("remote");
    expect(loads).toEqual({ remote: 0, add: 0, config: 0 });
    expect(await names(["remote"], "")).toEqual(expect.arrayContaining(["add", "list"]));
    expect(await names(["remote", "add"], "--f")).toContain("--force");
    expect(await names(["help", "remote"], "")).toEqual(expect.arrayContaining(["add", "list"]));
    expect(loads).toEqual({ remote: 1, add: 1, config: 0 });
  });

  test(`loadSpec returning ${kind}: the spec checks load every command`, async () => {
    const { spec, loads } = lazyCli(wrap);
    await Testing.test(spec as Subcommand, { allowNoDescription: true })();
    expect(loads).toEqual({ remote: 1, add: 1, config: 1 });
  });
}

test("loadSpec: a body returned directly keeps parse synchronous", () => {
  const { spec } = lazyCli((body) => body);
  const result = parseOrWait(["remote", "add", "x"], spec);
  expect(result).not.toBeInstanceOf(Promise);
  expect((result as ParseResult).args).toEqual(["x"]);
});

test("loadSpec: parse and readNext throw instead of waiting for a promise", () => {
  const { spec } = lazyCli((body) => Promise.resolve(body));
  expect(() => parse(["remote", "list"], spec)).toThrow(/loadSpec returned a promise/);
  expect(() => readNext(spec, ["config"], "")).toThrow(/loadSpec returned a promise/);
});

test("loadSpec: a problem before the command means it's never loaded", async () => {
  const { spec, loads } = lazyCli((body) => Promise.resolve(body));
  const result = await captureConsole(() => run(spec, ["--nope", "remote", "list"]));
  expect(result.code).toBe(1);
  expect(loads).toEqual({ remote: 0, add: 0, config: 0 });
});

test("loadSpec: a load that fails is reported like an action that throws", async () => {
  for (const loadSpec of [
    () => Promise.reject(new Error("no such file")),
    () => {
      throw new Error("no such file");
    },
  ]) {
    const spec: Spec = { name: "forge", subcommands: [{ name: "x", loadSpec }] };
    const result = await captureConsole(() => run(spec, ["x"]));
    expect(result.code).toBe(1);
    expect(result.stderr).toBe("Error: no such file\n");
  }
});

// The same spec and command line, read eagerly and then with every
// subcommand's body behind a loadSpec, must come out the same.

const bodyKeys = [
  "args",
  "options",
  "subcommands",
  "parserDirectives",
  "requiresSubcommand",
  "action",
] as const;

/**
 * Move the body of every subcommand below `command` behind a `loadSpec`, in
 * place, so the commands are the same objects before and after.
 */
function unload(command: Spec | Subcommand, wrap: (body: CommandBody) => CommandBody | Promise<CommandBody>) {
  const seen = new Set<Subcommand>();
  const visit = (parent: Spec | Subcommand) => {
    for (const subcommand of parent.subcommands ?? []) {
      if (seen.has(subcommand)) {
        continue;
      }
      seen.add(subcommand);
      visit(subcommand);
      const body: Record<string, unknown> = {};
      for (const key of bodyKeys) {
        if (subcommand[key] !== undefined) {
          body[key] = subcommand[key];
          delete subcommand[key];
        }
      }
      subcommand.loadSpec = () => wrap(body as CommandBody);
    }
  };
  visit(command);
}

async function attemptOrWait(input: readonly string[], spec: Spec): Promise<Outcome> {
  try {
    return { ok: true, result: await parseOrWait(input, spec) };
  } catch (error) {
    return { ok: false, error: error as Error & Record<string, unknown> };
  }
}

/** What `cli help <names>` prints and returns, with the help command as a subcommand of the root. */
async function helpCommandView(spec: Spec, names: string[]): Promise<string> {
  const init = {
    path: [spec, helpCommand],
    args: names,
    help: (config: HelpConfig & { path: NonEmptyArray<Subcommand> }) => getHelp(config.path, config),
  };
  const { code, stdout, stderr } = await captureConsole(() =>
    helpCommand.action!(init as unknown as ActionInit),
  );
  return JSON.stringify({ code, stdout, stderr });
}

/** What completion offers after `before`, in order. */
async function completionView(spec: Spec, before: string[], partial: string): Promise<string> {
  try {
    return JSON.stringify(await completeRuntime({ spec, before, partial, gateOptions: partial !== "" }));
  } catch (error) {
    return `threw ${String(error)}`;
  }
}

/** The first spec check that fails, or "ok". */
async function specCheckView(spec: Spec): Promise<string> {
  try {
    await Testing.test(spec as Subcommand)();
    return "ok";
  } catch (error) {
    return String(error);
  }
}

test("loadSpec: the spec checks report a problem inside a loaded body", async () => {
  const spec: Spec = {
    name: "forge",
    subcommands: [
      {
        name: "remote",
        loadSpec: () => Promise.resolve({ options: [{ name: "--force" }, { name: "--force" }] }),
      },
    ],
  };
  await expect(Testing.test(spec as Subcommand, { allowNoDescription: true })()).rejects.toThrow(/--force/);
});

vi.setConfig({ testTimeout: TIMEOUT * 4 });

test("random specs read, complete, print help and check the same with every body behind a loadSpec", async () => {
  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), {
      persistentSubcommands: true,
      hiddenSubcommands: true,
      defaults: true,
    });
    const spec = gen.spec();
    const input = gen.input(spec);
    const partial = input.length > 0 && n % 2 === 0 ? input[input.length - 1] : "";
    const before = partial === "" ? input : input.slice(0, -1);

    const eager = await attemptOrWait(input, spec);
    const eagerNext = readNext(spec, before, partial);
    // The views that only text can compare: the help command following the
    // line as names, completion, and the first spec check that fails.
    const views = [helpCommandView, (s: Spec) => completionView(s, before, partial), specCheckView] as const;
    const eagerViews: string[] = [];
    for (const view of views) {
      eagerViews.push(await view(spec, input));
    }
    for (const [kind, wrap] of kinds) {
      for (let i = 0; i < views.length; i++) {
        unload(spec, wrap);
        const lazyView = await views[i](spec, input);
        await loadAll(spec);
        if (lazyView !== eagerViews[i]) {
          const what = ["the help command", "completion", "the spec checks"][i];
          expect.fail(
            report(
              n,
              spec,
              input,
              `with loadSpec returning ${kind}, ${what}: ${lazyView} instead of ${eagerViews[i]}`,
            ),
          );
        }
      }

      unload(spec, wrap);
      const lazy = await attemptOrWait(input, spec);
      const problem = difference(eager, lazy, Object.is, OPTION_NAMES);
      if (problem) {
        expect.fail(report(n, spec, input, `with loadSpec returning ${kind}, parse: ${problem}`));
      }
      await loadAll(spec);

      unload(spec, wrap);
      const lazyNext = await readNextOrWait(spec, before, partial);
      await loadAll(spec);
      // The lazy read is compared after loading, since it lists stubs that weren't entered.
      const nextProblem = nextDifference(eagerNext, lazyNext);
      if (nextProblem) {
        expect.fail(report(n, spec, input, `with loadSpec returning ${kind}, readNext: ${nextProblem}`));
      }
    }
  }
});

test("loadSpec: help for another path loads the commands on it", async () => {
  const sub: Subcommand = {
    name: "sub",
    loadSpec: () => ({ options: [{ name: "--force" }], subcommands: [{ name: "leaf" }] }),
  };
  const spec: Spec = {
    name: "cli",
    subcommands: [sub, { name: "show", action: ({ help }) => console.log(help({ path: [spec, sub] })) }],
  };
  const result = await captureConsole(() => run(spec, ["show"]));
  expect(result.stdout).toContain("Commands:\n  leaf");
  expect(result.stdout).toContain("Flags:\n  --force");
});

test("loadSpec: help for a path whose body is a promise says it isn't loaded", async () => {
  const sub: Subcommand = {
    name: "sub",
    loadSpec: () => Promise.resolve({ options: [{ name: "--force" }], subcommands: [{ name: "leaf" }] }),
  };
  const spec: Spec = {
    name: "cli",
    subcommands: [sub, { name: "show", action: ({ help }) => console.log(help({ path: [spec, sub] })) }],
  };
  const result = await captureConsole(() => run(spec, ["show"]));
  expect(result.code).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toContain("'sub' isn't loaded");
  // The load it started still finishes, so the path can be read after it.
  await Promise.resolve();
  expect(getHelp([spec, sub])).toContain("Commands:\n  leaf");
});

test("loadSpec: reading tokens one at a time refuses to read past a body that's a promise", () => {
  const spec: Spec = {
    name: "cli",
    subcommands: [{ name: "sub", loadSpec: () => Promise.resolve({ options: [{ name: "--force" }] }) }],
  };
  expect(readToken(spec, [], "sub").kind).toBe("subcommand");
  expect(() => readToken(spec, ["sub"], "--force")).toThrow(/can't be read synchronously/);
});
