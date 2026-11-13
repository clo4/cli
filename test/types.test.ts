import type { ActionInit, Arg, Option, Spec, Subcommand } from "../src/index.js";
import { test } from "vitest";

test("type surface compiles", () => {});

const spec = {
  name: "demo",
  description: "Demo command.",
  options: [{ name: ["-v", "--verbose"], isRepeatable: true, description: "Increase verbosity." }],
  subcommands: [
    {
      name: ["build", "b"],
      args: { name: "input" },
      options: [{ name: "--out", args: { name: "dir" }, isRequired: true }],
      action({ args, options }: ActionInit) {
        args satisfies string[];
        options.get("--out") satisfies string | undefined;
      },
    },
  ],
} satisfies Spec;

spec.subcommands[0].args satisfies Arg;
spec.subcommands[0].options[0] satisfies Option;

const option: Option = { name: "--option" };

// @ts-expect-error Options and subcommands are intentionally not structurally interchangeable.
option satisfies Subcommand;

// A loadSpec gives a whole command, with its name.
({
  name: "group",
  loadSpec: () => ({ name: "group", subcommands: [{ name: "child" }] }),
}) satisfies Subcommand;
({ name: "group", loadSpec: () => Promise.resolve({ name: "group", action: () => 0 }) }) satisfies Subcommand;

// @ts-expect-error A loaded command has a name.
({ name: "group", loadSpec: () => ({ subcommands: [{ name: "child" }] }) }) satisfies Subcommand;

// @ts-expect-error The root command has no loadSpec.
({ name: "root", loadSpec: () => ({ name: "root" }) }) satisfies Spec;

declare const moduleNamespace: Promise<{ default: Subcommand }>;
// @ts-expect-error loadSpec gives the command, so a dynamic import has to be unwrapped.
({ name: "group", loadSpec: () => moduleNamespace }) satisfies Subcommand;
({ name: "group", loadSpec: () => moduleNamespace.then((module) => module.default) }) satisfies Subcommand;

// @ts-expect-error Alias arrays must contain at least two names.
({ name: ["--lonely"] }) satisfies Option;

// Completion-only metadata is part of the Arg schema (no effect on parsing).
({ name: "path", template: "filepaths" }) satisfies Arg;
({
  name: "branch",
  suggestions: ["main", { name: "release", description: "Release branch" }],
  generators: { custom: (tokens) => tokens },
}) satisfies Arg;

// @ts-expect-error template must be a known completion template.
({ name: "bad", template: "nonsense" }) satisfies Arg;
