import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import { parse } from "../src/parse.js";
import { testSpec } from "../src/testing.js";

/** Fails to compile unless `Actual` is exactly `Expected`. */
function is<Expected>() {
  return <Actual>(
    _value: Actual,
    ..._same: (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? [] : [never]
  ): void => {};
}

// A description the compiler only knows is a string, like one read from a catalog.
const described: string = ["Described", "at", "runtime."].join(" ");
const listTargets = (tokens: string[]): Promise<string[]> => Promise.resolve(tokens);

test("spec and command return the object they're given", () => {
  const root = { name: "demo" };
  const sub = { name: "build" };
  expect(CLI.spec(root)).toBe(root);
  expect(CLI.command(sub)).toBe(sub);
});

// Everything below is checked by the compiler. The actions never run.

// A command written outside the spec, with a typed action of its own.
const status = CLI.command({
  name: "status",
  description: "Show status.",
  args: { name: "switch", isOptional: true, suggestions: ["a", "b"] },
  options: [{ name: "--all", description: "Show everything." }],
  action({ args: [name], options }) {
    is<string | undefined>()(name);
    return options.has("--all") ? 0 : 1;
  },
});

// A named action written against the loose type.
async function fmt({ options }: CLI.ActionInit): Promise<number> {
  return options.has("--check") ? 0 : 1;
}

// A helper that takes the loose options accepts the typed ones.
function verbose(options: CLI.OptionArgs): boolean {
  return options.has("--verbose");
}

// An option made by a function has names the compiler can't see.
function reason(): CLI.Option {
  return { name: "--reason", description: "Why.", args: { name: "text" } };
}

const demo = CLI.spec({
  name: "demo",
  description: described,
  requiresSubcommand: true,
  options: [
    CLI.help,
    { name: ["-v", "--verbose"], description: "Say more.", isPersistent: true },
    { name: "--root-only", description: "Only on the root." },
  ],
  action({ args, options }) {
    is<[]>()(args);
    options.has("--root-only");
    options.has("--help");
  },
  subcommands: [
    CLI.helpCommand,
    CLI.completion,
    status,
    {
      name: "fmt",
      description: "Format.",
      options: [{ name: "--check", description: "Check." }],
      action: fmt,
    },
    {
      name: "build",
      description: described,
      args: {
        name: "file",
        isOptional: true,
        template: ["filepaths", "folders"],
        generators: { custom: async (tokens) => listTargets(tokens) },
      },
      options: [
        { name: "--watch", description: "Watch." },
        { name: ["-o", "--output"], description: "Where.", args: { name: "dir", default: "dist" } },
        { name: "--out", description: "Where.", args: { name: "dir" }, isRequired: true },
        { name: "--tag", description: "Tag.", args: { name: "t" }, isRepeatable: true },
        { name: "--size", description: "Size.", args: [{ name: "w" }, { name: "h" }] },
        {
          name: "--fit",
          description: "Fit.",
          args: [
            { name: "w", default: "80" },
            { name: "h", default: "24" },
          ],
        },
        {
          name: "--inspect",
          description: "Inspect.",
          args: { name: "port", isOptional: true, default: "9229" },
        },
        {
          name: "--target",
          description: "Target.",
          args: { name: "t", generators: { custom: (tokens) => tokens } },
        },
        { name: "--version", description: "Version.", action: ({ help }) => void help() },
        { name: "--pure", description: "Pure.", args: { name: "c" }, exclusiveOn: ["--watch"] },
      ],
      action({ args: [file], options, help, path, argSeparatorIndex }) {
        is<string | undefined>()(file);
        is<string>()(options.get("-o"));
        is<string>()(options.get("--out"));
        is<string | undefined>()(options.get("--target"));
        is<string | undefined>()(options.get("--inspect"));
        // @ts-expect-error A flag has no value to get.
        options.get("--watch");
        // @ts-expect-error A flag has no values either.
        options.all("--watch");
        is<string[]>()(options.all("--tag"));
        is<string[]>()(options.all("--size"));
        is<[string, string]>()(options.all("--fit"));
        is<[string]>()(options.all("--out"));
        is<boolean>()(options.has("-v"));
        is<number>()(options.count("--tag"));
        is<boolean>()(verbose(options));
        is<string>()(help());
        is<CLI.CommandPath>()(path);
        is<number>()(argSeparatorIndex);
        // @ts-expect-error A misspelled name.
        options.has("--wach");
        // @ts-expect-error An option of the root that isn't persistent.
        options.has("--root-only");
        // @ts-expect-error A name of another command.
        options.get("--check");
      },
    },
    {
      name: "sourcemap",
      description: "Source maps.",
      requiresSubcommand: true,
      options: [{ name: "--raw", description: "Raw.", isPersistent: true }],
      subcommands: [
        {
          name: ["decode", "d"],
          description: "Decode.",
          args: [{ name: "map" }, { name: "source", isOptional: true }],
          options: [{ name: "--json", description: "As JSON." }],
          action: ({ args, options }) => {
            is<[string] | [string, string]>()(args);
            return options.has("--json") || options.has("--raw") || options.has("--verbose") ? 0 : 1;
          },
          subcommands: [
            {
              name: "deepest",
              description: "Three levels down.",
              args: { name: "x", isVariadic: true },
              action({ args, options }) {
                is<[string, ...string[]]>()(args);
                options.has("--raw");
                options.has("-h");
                // @ts-expect-error An option of the parent that isn't persistent.
                options.has("--json");
              },
            },
          ],
        },
      ],
    },
    {
      name: "audit",
      description: "With an option whose names the compiler can't see.",
      options: [reason(), { name: "--rotate", description: "Rotate." }],
      action({ options }) {
        // Any name is accepted, since `--reason` can't be told from a misspelling.
        is<string | undefined>()(options.get("--reason"));
        is<string[]>()(options.all("--reason"));
        options.has("--rotate");
      },
    },
    {
      name: "remote",
      description: "From another file.",
      loadSpec: () => import("./fixtures/remote.js").then((module) => module.default),
    },
    {
      name: "local",
      description: "From this file.",
      loadSpec: () =>
        CLI.command({
          name: "local",
          subcommands: [
            {
              name: "add",
              description: "Add.",
              args: { name: "url" },
              action({ args }) {
                is<[string]>()(args);
              },
            },
          ],
        }),
    },
  ],
});

test("a spec made with spec parses and passes the spec checks", async () => {
  expect(parse(["build", "--out", "x"], demo).path.map((command) => command.name)).toEqual(["demo", "build"]);
  await testSpec(demo, { allowLongDescriptionLines: true })();
});

// Positional arguments.
CLI.spec({
  name: "args",
  subcommands: [
    {
      name: "defaults",
      args: [{ name: "a" }, { name: "b", isOptional: true, default: "." }, { name: "c", isOptional: true }],
      action: ({ args }) => is<[string, string] | [string, string, string]>()(args),
    },
    {
      // The parser stops adding defaults at the first optional argument without one.
      name: "gap",
      args: [
        { name: "a", isOptional: true },
        { name: "b", isOptional: true, default: "." },
      ],
      action: ({ args }) => is<[] | [string] | [string, string]>()(args),
    },
    {
      name: "rest",
      args: [{ name: "a" }, { name: "b", isOptional: true, isVariadic: true }],
      action: ({ args }) => is<[string, ...string[]]>()(args),
    },
    { name: "group", requiresSubcommand: true, action: ({ args }) => is<[]>()(args) },
    { name: "none", action: ({ args }) => is<[]>()(args) },
  ],
});

// An argument typed `Arg` doesn't say whether it's optional, so the action gets a list.
const shared: CLI.Arg = { name: "client" };
CLI.spec({
  name: "wide",
  args: shared,
  action: ({ args }) => is<string[]>()(args),
  subcommands: [
    { name: "spread", args: { ...shared, description: "x" }, action: ({ args }) => is<string[]>()(args) },
  ],
});

// Completion callbacks keep their parameter types wherever they are.
CLI.spec({
  name: "callbacks",
  subcommands: [
    {
      name: "first",
      action({ args }) {
        is<[]>()(args);
      },
    },
    {
      name: "second",
      args: { name: "f", generators: [{ custom: async (tokens) => tokens }, { custom: (tokens) => tokens }] },
    },
    {
      name: "third",
      args: [
        { name: "f", generators: { custom: (tokens) => tokens } },
        { name: "g", isOptional: true },
      ],
      action: ({ args }) => is<[string] | [string, string]>()(args),
    },
  ],
});

// The ways to write a loadSpec that imports a file.
CLI.spec({
  name: "loads",
  subcommands: [
    { name: "remote", loadSpec: async () => (await import("./fixtures/remote.js")).default },
    {
      name: "remote",
      loadSpec: () => import("./fixtures/remote.js").then((module) => module.default),
    },
    {
      name: "c",
      action({ args }) {
        is<[]>()(args);
      },
    },
  ],
});

// Two options that share a name are each read by a ref.
CLI.spec({
  name: "refs",
  options: [{ name: ["-v", "--verbose"], isPersistent: true, isRepeatable: true, ref: "verbose" }],
  subcommands: [
    {
      name: "sub",
      options: [{ name: ["-v", "--version"], ref: "version", args: { name: "v", default: "1" } }],
      action({ options }) {
        is<string>()(options.get("version"));
        // @ts-expect-error A flag has no value to get, by its ref either.
        options.get("verbose");
        is<number>()(options.count("verbose"));
        // The shared name could be either option.
        is<string | undefined>()(options.get("-v"));
        // @ts-expect-error A ref no option has.
        options.has("verbos");
      },
    },
  ],
});

// An option's action reads the options of its command by name, and gets a list of arguments.
function loose({ options }: CLI.ActionInit): number {
  return options.has("--anything") ? 0 : 1;
}
CLI.spec({
  name: "option-actions",
  options: [{ name: "--verbose", isPersistent: true }],
  subcommands: [
    {
      name: "build",
      args: [{ name: "source" }, { name: "destination" }],
      options: [
        { name: "--output", args: { name: "dir", default: "dist" }, isRequired: true },
        {
          name: "--version",
          action({ args, options, help }) {
            // The checks for argument counts and required options haven't run.
            is<string[]>()(args);
            is<string | undefined>()(options.get("--output"));
            is<string[]>()(options.all("--output"));
            is<boolean>()(options.has("--verbose"));
            is<number>()(options.count("--version"));
            is<string>()(help());
            // @ts-expect-error A misspelled name.
            options.has("--outptu");
          },
        },
        // An action written against the loose type is still accepted.
        { name: "--about", action: loose },
      ],
    },
  ],
});

// Lists of plain values written with a spread.
const switches: ("east" | "west")[] = ["east", "west"];
const extra = "all" as const;
CLI.spec({
  name: "spreads",
  args: { name: "switch", isOptional: true, suggestions: [...switches, extra, "none"] },
  subcommands: [
    {
      name: "a",
      args: { name: "switch", suggestions: ["first", ...switches] },
      options: [{ name: ["-x", "--extra"], args: { name: "v", suggestions: [...switches] } }],
      action({ args, options }) {
        is<[string]>()(args);
        options.has("--extra");
      },
    },
  ],
  action: ({ args }) => is<[] | [string]>()(args),
});

// An option refers to other options by names the command can use.
CLI.spec({
  name: "relations",
  options: [{ name: ["-q", "--quiet"], isPersistent: true }, { name: "--root-only" }],
  subcommands: [
    {
      name: "build",
      options: [
        { name: "--json", exclusiveOn: ["--quiet", "--pretty"] },
        { name: "--pretty", ref: "pretty" },
        { name: "--sign", dependsOn: ["--output"] },
        { name: "--output", args: { name: "file" } },
        // @ts-expect-error A misspelled name.
        { name: "--a", dependsOn: ["--outptu"] },
        // @ts-expect-error An option of the root that isn't persistent.
        { name: "--b", exclusiveOn: ["--root-only"] },
        // @ts-expect-error A ref isn't a name.
        { name: "--c", exclusiveOn: ["pretty"] },
      ],
    },
  ],
});

// A command with only flags still passes its options to a helper that takes the loose ones.
CLI.spec({
  name: "flags",
  options: [{ name: "--verbose" }],
  action: ({ options }) => is<boolean>()(verbose(options)),
  subcommands: [{ name: "bare", action: ({ options }) => is<boolean>()(verbose(options)) }],
});

// The typed arguments pass to anything that takes a list of strings, and the whole typed init to a loose action.
function count(words: string[]): number {
  return words.length;
}
CLI.spec({
  name: "pass-on",
  args: [{ name: "a" }, { name: "b", isOptional: true }],
  action: ({ args }) => count(args),
  subcommands: [
    {
      name: "loose",
      args: { name: "f", isOptional: true },
      options: [{ name: "--check" }],
      action: (init) => fmt(init),
    },
  ],
});

// What the shape check rejects.
// @ts-expect-error A field with the wrong type.
CLI.spec({ name: "x", subcommands: [{ name: "a", args: { name: "f", isOptional: "yes" } }] });
// @ts-expect-error A field the schema doesn't have.
CLI.spec({ name: "x", subcommands: [{ name: "a", arg: { name: "f" } }] });
CLI.spec({
  name: "x",
  subcommands: [
    {
      name: "a",
      // @ts-expect-error A field the schema doesn't have, beside an inline action.
      arg: { name: "f" },
      action({ args }) {
        void args;
      },
    },
  ],
});
// @ts-expect-error An alias list with one name.
CLI.spec({ name: "x", options: [{ name: ["--lonely"] }] });
// @ts-expect-error An empty list of options.
CLI.spec({ name: "x", options: [] });
// @ts-expect-error A list of one argument, which is written without the list.
CLI.spec({ name: "x", args: [{ name: "f" }] });
// @ts-expect-error A template that doesn't exist.
CLI.spec({ name: "x", args: { name: "f", template: "nonsense" } });
// @ts-expect-error A command without a name.
CLI.command({ description: "x", subcommands: [{ name: "a" }] });
// @ts-expect-error Only a subcommand has a loadSpec.
CLI.spec({ name: "x", loadSpec: () => ({ name: "x" }) });
CLI.spec({
  name: "x",
  args: { name: "f", isOptional: true },
  // @ts-expect-error An action that asks for more than its command gives.
  action: (init: { args: [string] }) => void init,
});
