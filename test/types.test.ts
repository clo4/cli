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
