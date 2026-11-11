import type { ActionInit, Arg, CommandBody, Option, Spec, Subcommand } from "../src/index.js";
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

// A command body is a subcommand without what its parent reads first.
({ args: { name: "input" }, requiresSubcommand: true }) satisfies CommandBody;
({ name: "group", loadSpec: () => ({ subcommands: [{ name: "child" }] }) }) satisfies Subcommand;
({ name: "group", loadSpec: () => Promise.resolve({ action: () => 0 }) }) satisfies Subcommand;

// @ts-expect-error An option isn't a command body, though they share properties.
option satisfies CommandBody;

// @ts-expect-error The parent has already matched the name, so a body can't set one.
({ name: "other" }) satisfies CommandBody;

// @ts-expect-error A body can't have a loadSpec of its own.
({ loadSpec: () => ({}) }) satisfies CommandBody;

declare const moduleNamespace: Promise<{ default: CommandBody }>;
// @ts-expect-error loadSpec gives the body, so a dynamic import has to be unwrapped.
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
