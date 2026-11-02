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

Use `@clo4/cli/testing` in package tests to validate structural constraints that TypeScript cannot express, such as duplicate names, bad required/optional argument order, invalid repeatable options, and invalid option references.

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

### Completion modes: `--runtime` (default) and `--shell`

By default, `completion <shell>` emits a a shim that executes itself as `<cli> completion complete -- <commandline>`, allowing it to reuse its own parser. This is slower on average, but allows it to provide native-feeling completions that respect your nitpicky parser options. So long as you keep the startup time of your CLI acceptable, there isn't much of a downside to this.

Alternatively, `completion <shell> --shell` emits a self-contained shell completion script. It can't track line state, so relationship filters like `exclusiveOn`/`isRepeatable` aren't applied. Dynamic generators still call back via `completion generate-suggestions`.

In runtime mode, the bash and fish shims pass `--gate-options`, so options are only offered once the word starts with `-` (matching fish/bash convention); zsh omits it and surfaces options as usual. Flip this by editing which shims pass the option.

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
- `generators.custom(tokens)` returns dynamic suggestions: in runtime mode it runs in-process, in `--shell` mode it is reached via the hidden `completion generate-suggestions <location>` callback.
