import * as CLI from "../../src/index.ts";
import { spec, command } from "./lib.ts";
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
declare function expect<T>(): <U>(v: U) => Eq<T, U> extends true ? void : { error: U };
const ok = (x: void) => x;
declare const described: string;
declare function listTargets(tokens: string[]): Promise<string[]>;

// an extracted command, as nightwatch writes them
const status = command({
  name: "status",
  args: { name: "switch", isOptional: true, suggestions: ["a", "b"] },
  options: [{ name: "--all" }],
  action({ args: [name], options }) {
    ok(expect<string | undefined>()(name));
    return options.has("--all") ? 0 : 1;
  },
});
// a named action with the loose type, as lodestone writes them
async function fmt({ options }: CLI.ActionInit): Promise<number> {
  return options.has("--check") ? 0 : 1;
}

export const s = spec({
  name: "lode",
  description: described,
  requiresSubcommand: true,
  options: [CLI.help, { name: ["-v", "--verbose"], isPersistent: true }],
  subcommands: [
    CLI.helpCommand,
    CLI.completion,
    status,
    { name: "fmt", args: { name: "input", isOptional: true }, options: [{ name: "--check" }], action: fmt },
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
        { name: "--watch" },
        { name: ["-o", "--output"], args: { name: "dir", default: "dist", template: "folders" } },
        {
          name: "--tag",
          args: { name: "t", generators: { custom: (tokens) => tokens } },
          isRepeatable: true,
        },
        {
          name: "--version",
          action: ({ help }) => {
            console.log(help());
          },
        },
        { name: "--pure", args: { name: "c" }, exclusiveOn: ["--watch"] },
      ],
      action({ args: [file], options, help, path }) {
        ok(expect<string | undefined>()(file));
        ok(expect<string>()(options.get("-o")));
        options.has("-v");
        options.has("--tag");
        help();
        void path;
        // @ts-expect-error typo
        options.has("--wach");
      },
    },
    {
      name: "sourcemap",
      requiresSubcommand: true,
      subcommands: [
        {
          name: ["decode", "d"],
          args: [{ name: "map" }, { name: "source", isOptional: true }],
          options: [{ name: "--json" }],
          action: ({ args, options }) => {
            ok(expect<[string, string?]>()(args));
            return options.has("--json") || options.has("--verbose") ? 0 : 1;
          },
        },
      ],
    },
    {
      name: "remote",
      description: "Manage remotes.",
      loadSpec: () => import("./remote.ts").then((m) => m.default),
    },
    {
      name: "local",
      loadSpec: () =>
        command({
          subcommands: [
            {
              name: "add",
              args: { name: "url" },
              action({ args }) {
                ok(expect<[string]>()(args));
              },
            },
          ],
        }),
    },
  ],
});
void CLI.run(s);

// @ts-expect-error a wrong shape
spec({ name: "x", subcommands: [{ name: "a", args: { name: "f", isOptional: "yes" } }] });
// @ts-expect-error an unknown field
spec({ name: "x", subcommands: [{ name: "a", arg: { name: "f" } }] });
