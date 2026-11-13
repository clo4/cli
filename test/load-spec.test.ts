import { expect, test, vi } from "vitest";

import { completeRuntime } from "../src/completion.js";
import { getHelp } from "../src/help.js";
import type { HelpConfig } from "../src/help.js";
import { help, helpCommand } from "../src/index.js";
import { parse, parseOrWait, readNext, readNextOrWait, readToken } from "../src/parse.js";
import type { ParseResult } from "../src/parse.js";
import { loadAll } from "../src/scope.js";
import * as Testing from "../src/testing.js";
import type { ActionInit, NonEmptyArray, Spec, Subcommand } from "../src/types.js";
import { TIMEOUT, caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator } from "./fuzz/generate.js";
import { difference, nextDifference } from "./fuzz/snapshot.js";
import type { Outcome } from "./fuzz/snapshot.js";
import { captureConsole, run, runSpecCheck } from "./helpers.js";

/** How a `loadSpec` gives its command: as it is, or as a promise of it. */
type Wrap = (command: Subcommand) => Subcommand | Promise<Subcommand>;

/** A CLI with two groups that load, and a count of the loads of each. */
function lazyCli(wrap: Wrap) {
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
            name: ["remote", "r"],
            requiresSubcommand: true,
            subcommands: [
              {
                name: "add",
                description: "Add a remote.",
                loadSpec() {
                  loads.add++;
                  return wrap({
                    name: "add",
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
          return wrap({
            name: "config",
            args: { name: "key" },
            action: ({ args }) => void ran.push(`config:${args[0]}`),
          });
        },
      },
    ],
  };
  return { spec, loads, ran };
}

const kinds: [string, Wrap][] = [
  ["a command", (command) => command],
  ["a promise", (command) => Promise.resolve(command)],
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

test("loadSpec: a command returned directly keeps parse synchronous", () => {
  const { spec } = lazyCli((command) => command);
  const result = parseOrWait(["remote", "add", "x"], spec);
  expect(result).not.toBeInstanceOf(Promise);
  expect((result as ParseResult).args).toEqual(["x"]);
});

test("loadSpec: parse and readNext throw instead of waiting for a promise", () => {
  const { spec } = lazyCli((command) => Promise.resolve(command));
  expect(() => parse(["remote", "list"], spec)).toThrow(/loadSpec returned a promise/);
  expect(() => readNext(spec, ["config"], "")).toThrow(/loadSpec returned a promise/);
});

test("loadSpec: a problem before the command means it's never loaded", async () => {
  const { spec, loads } = lazyCli((command) => Promise.resolve(command));
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
// subcommand behind a loadSpec, must come out the same.

/** What stays on a command beside its `loadSpec`. */
const readBeforeLoading = ["name", "description", "hidden", "isPersistent"];

/**
 * Move every subcommand below `command` behind a `loadSpec`, in place, so the
 * commands are the same objects before and after. Each one keeps what its
 * parent reads before it loads, and loads a command with the same name and
 * everything else it had.
 */
function unload(command: Spec | Subcommand, wrap: Wrap) {
  const seen = new Set<Subcommand>();
  const visit = (parent: Spec | Subcommand) => {
    for (const subcommand of parent.subcommands ?? []) {
      if (seen.has(subcommand)) {
        continue;
      }
      seen.add(subcommand);
      visit(subcommand);
      const fields = subcommand as unknown as Record<string, unknown>;
      const loaded: Record<string, unknown> = { name: subcommand.name };
      for (const key of Object.keys(fields)) {
        if (!readBeforeLoading.includes(key) && fields[key] !== undefined) {
          loaded[key] = fields[key];
          delete fields[key];
        }
      }
      subcommand.loadSpec = () => wrap(loaded as unknown as Subcommand);
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

test("loadSpec: the spec checks report a problem inside a loaded command", async () => {
  const spec: Spec = {
    name: "forge",
    subcommands: [
      {
        name: "remote",
        loadSpec: () =>
          Promise.resolve({ name: "remote", options: [{ name: "--force" }, { name: "--force" }] }),
      },
    ],
  };
  await expect(Testing.test(spec as Subcommand, { allowNoDescription: true })()).rejects.toThrow(/--force/);
});

vi.setConfig({ testTimeout: TIMEOUT * 4 });

test("random specs read, complete, print help and check the same with every subcommand behind a loadSpec", async () => {
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
    loadSpec: () => ({ name: "sub", options: [{ name: "--force" }], subcommands: [{ name: "leaf" }] }),
  };
  const spec: Spec = {
    name: "cli",
    subcommands: [sub, { name: "show", action: ({ help }) => console.log(help({ path: [spec, sub] })) }],
  };
  const result = await captureConsole(() => run(spec, ["show"]));
  expect(result.stdout).toContain("Commands:\n  leaf");
  expect(result.stdout).toContain("Flags:\n  --force");
});

test("loadSpec: help for a path whose loadSpec gives a promise says it isn't loaded", async () => {
  const sub: Subcommand = {
    name: "sub",
    loadSpec: () =>
      Promise.resolve({ name: "sub", options: [{ name: "--force" }], subcommands: [{ name: "leaf" }] }),
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

test("loadSpec: reading tokens one at a time refuses to read past a loadSpec that gives a promise", () => {
  const spec: Spec = {
    name: "cli",
    subcommands: [
      { name: "sub", loadSpec: () => Promise.resolve({ name: "sub", options: [{ name: "--force" }] }) },
    ],
  };
  expect(readToken(spec, [], "sub").kind).toBe("subcommand");
  expect(() => readToken(spec, ["sub"], "--force")).toThrow(/can't be read synchronously/);
});

test("loadSpec: what the parent read before the load stays as the parent has it", async () => {
  const spec: Spec = {
    name: "forge",
    subcommands: [
      {
        name: ["remote", "r"],
        description: "Manage remotes.",
        loadSpec: () => ({
          name: "other",
          description: "Something else.",
          hidden: true,
          args: { name: "url" },
        }),
      },
    ],
  };
  const result = await captureConsole(() => run(spec, ["r", "--help"]));
  expect(result.stderr).toContain("forge remote <url>");
  const remote = spec.subcommands![0];
  expect(remote.name).toEqual(["remote", "r"]);
  expect(remote.description).toBe("Manage remotes.");
  expect(remote.hidden).toBeUndefined();
  expect(remote.loadSpec).toBeUndefined();
});

test("loadSpec: the spec checks compare a loaded command with the command that loads it", async () => {
  const check = (stub: Partial<Subcommand>, loaded: Partial<Subcommand>) =>
    runSpecCheck("assertLoadedCommandsMatch", {
      name: "forge",
      subcommands: [
        { name: "remote", ...stub, loadSpec: () => ({ name: "remote", ...loaded }) as Subcommand },
      ],
    });
  // The loaded command can leave out what its parent reads, or say the same.
  await check({ description: "Manage remotes." }, { args: { name: "url" } });
  await check(
    { description: "Manage remotes.", hidden: true },
    { description: "Manage remotes.", hidden: true },
  );
  await check({ name: ["remote", "r"] }, { name: ["remote", "r"] });

  await expect(check({}, { name: "remotes" })).rejects.toThrow(
    'Subcommand `forge remote` (index 0) loads a command named "remotes". Give the loaded command the same `name`, "remote".',
  );
  await expect(check({ name: ["remote", "r"] }, { name: "remote" })).rejects.toThrow(
    /loads a command named "remote"/,
  );
  await expect(check({}, { name: undefined })).rejects.toThrow(/loads a command named undefined/);
  await expect(check({ description: "Manage remotes." }, { description: "Remotes." })).rejects.toThrow(
    'loads a command whose `description` is "Remotes.", but its own is "Manage remotes.", and its own is the one used.',
  );
  await expect(check({}, { hidden: true })).rejects.toThrow(
    "loads a command whose `hidden` is true, but its own is not set",
  );
  await expect(check({}, { isPersistent: true })).rejects.toThrow(/whose `isPersistent` is true/);
  await expect(check({}, { loadSpec: () => ({ name: "remote" }) })).rejects.toThrow(
    "loads a command that has a `loadSpec` of its own, which is never called.",
  );
});

test("loadSpec: the spec checks reject a command that sets more than its parent reads beside a loadSpec", async () => {
  const spec: Spec = {
    name: "forge",
    subcommands: [{ name: "remote", options: [{ name: "--force" }], loadSpec: () => ({ name: "remote" }) }],
  };
  await expect(runSpecCheck("assertLoadedCommandsMatch", spec)).rejects.toThrow(
    "Subcommand `forge remote` (index 0) has a `loadSpec` and sets `options`. Beside a `loadSpec`, a command only sets `name`, `description`, `hidden`, `isPersistent`. Move `options` to the command it loads.",
  );
});
