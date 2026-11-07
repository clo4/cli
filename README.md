# @clo4/cli

Fully declarative CLI framework, lean footprint, fast, good API for completions.

```ts
import * as CLI from "@clo4/cli";

const spec: CLI.Spec = {
  name: "demo",
  description: "Compile a project.",
  options: [CLI.help],
  subcommands: [
    {
      name: "build",
      description: "Build a project.",
      args: { name: "input" },
      options: [
        { name: "--watch", description: "Watch for changes." },
        {
          name: ["-o", "--output"],
          args: { name: "dir" },
          isRequired: true,
          description: "Write output to this directory.",
        },
      ],
      action({ args: [input], options }) {
        console.log(`${input} -> ${options.get("--output")}`);
      },
    },
  ],
};

process.exitCode = await CLI.run(spec);
```

Specs define `args`, `options`, `subcommands`, and `action` functions. Parsing and validating values stay in your code, it's not the job of the library.

Option actions override command actions. That lets helpers like `--help` run even when the selected command is missing required positional arguments.

A command without an action prints its help, so a command that only groups subcommands doesn't need one. Running `demo` above prints the root help.

Use `@clo4/cli/testing` in package tests to validate structural constraints that TypeScript cannot express, such as duplicate names, names the parser reads as something else, bad required/optional argument order, invalid repeatable options, and invalid option references.

## Shell completion

Add `CLI.completion` to a spec's `subcommands` to give the CLI a `completion <shell>` command that prints a completion script:

```ts
const spec: CLI.Spec = {
  name: "demo",
  options: [CLI.help],
  subcommands: [CLI.completion /* ... */],
};
```

```sh
demo completion bash > /etc/bash_completion.d/demo
demo completion zsh  > "${fpath[1]}/_demo"
demo completion fish > ~/.config/fish/completions/demo.fish
```

Completion describes the whole CLI from the root spec regardless of where the subcommand is placed. Hidden options and subcommands are excluded; persistent options are offered on the descendants that inherit them.

### How completion works

`completion <shell>` prints a short script. On every Tab, the script runs `<cli> completion complete -- <commandline>`, and the CLI answers using its own parser. Completions therefore follow every parser option and relationship rule (`exclusiveOn`, `isRepeatable`, `dependsOn`, and so on). Each Tab starts the CLI once, so keep its startup fast.

The bash and fish scripts pass `--gate-options`, so options are only offered once the word starts with `-`, which is the bash and fish convention. The zsh script leaves it out and offers options as usual.

### Argument suggestions

Arguments can declare completion metadata. These are only used for completions, not parsing.

```ts
{
  // dynamic completions: file/folder paths
  name: "--config",
  args: { name: "file", template: "filepaths" },
}

{
  // static completions
  name: "--mode",
  args: { name: "mode", suggestions: ["debug", "release"] },
}

{
  // fully dynamic completions using your own code
  name: "--target",
  args: {
    name: "target",
    generators: { custom: (tokens) => listTargets() },
  },
}
```

- `template` (`"filepaths"` / `"folders"`) completes paths.
- `suggestions` is a static list (strings or `{ name, description }`).
- `generators.custom(tokens)` returns dynamic suggestions. It runs inside the CLI when the shell asks for completions.
