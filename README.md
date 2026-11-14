# @clo4/cli

_A magical CLI framework, with no magic._

`@clo4/cli` is a TypeScript library for building command-line tools from plain objects. Parsing, TypeScript types, help, and shell completion for Bash, Zsh, Fish, PowerShell and Nushell all come from one command definition. Your application logic lives in ordinary functions.

- **Typed from the definition.** TypeScript infers each action's arguments, options and defaults from its command, with no separate schema to keep in sync. For commands written inside the root spec, the types also include persistent options, which a command shares with all its subcommands.
- **Custom completion.** An argument's suggestions can come from a fixed list, the shell's file path completion, or a sync or async function you write. You write no shell-specific code.
- **Fast startup.** The package has no runtime dependencies, and a large CLI can load each command only when it's used. See [Performance](#performance) for benchmarks.
- **Plain TypeScript.** There are no decorators, classes or lifecycle hooks. The library parses the command line, and your code converts and validates the values.

```bash
npm install @clo4/cli
```

## Custom shell completion

A completion generator is a function on an argument. This deployment tool suggests targets from an API:

```ts
options: [
  {
    name: "--target",
    args: {
      name: "target",
      generators: {
        custom: async (tokens) => listTargets(tokens),
      },
    },
  },
],
```

`listTargets` is your own function, and it returns strings or `{ name, description }` objects. The library finds the argument the user is completing, applies the command's parsing rules, and calls that argument's generator. Add the built-in `CLI.completion` subcommand to print a completion script for the user's shell.

[Help and completion](https://clo4.net/cli/v6/help-and-completion) covers installing the scripts and writing generators.

## Documentation

The full documentation is at [clo4.net/cli](https://clo4.net/cli/).

- [Options](https://clo4.net/cli/v6/options): flags, names, values, defaults, repeats and relationships
- [Arguments](https://clo4.net/cli/v6/arguments): positional and variadic arguments
- [Subcommands](https://clo4.net/cli/v6/subcommands): nested commands and global options
- [Actions](https://clo4.net/cli/v6/actions): errors, exit codes and types
- [Help and completion](https://clo4.net/cli/v6/help-and-completion): the built-in help and shell completion, with custom suggestions
- [Testing](https://clo4.net/cli/v6/testing): checks for mistakes that types can't express
- [Parser settings](https://clo4.net/cli/v6/parser-settings): changes to how a command line is read
- [Performance](https://clo4.net/cli/v6/performance): benchmarks and loading commands on demand
- [Choosing a CLI library](https://clo4.net/cli/v6/choosing-a-cli-library): how it compares with Commander, citty, Yargs and oclif

## Example

This example defines `demo build`, with an input directory, an output option and a watch flag. The action prints the selected paths and whether watch mode was requested.

Save this as `demo.ts` in a project with `"type": "module"` in its `package.json`. Run the examples with Node.js 24 or later using its [built-in TypeScript support](https://nodejs.org/api/typescript.html#type-stripping):

```ts
import * as CLI from "@clo4/cli";

const spec = CLI.spec({
  name: "demo",
  description: "A small build tool.",
  options: [CLI.help],
  subcommands: [
    {
      name: "build",
      description: "Build a project.",
      args: {
        name: "input",
        description: "Source directory.",
        isOptional: true,
        default: ".",
        template: "folders",
      },
      options: [
        {
          name: ["-w", "--watch"],
          description: "Watch for changes.",
        },
        {
          name: ["-o", "--output"],
          description: "Output directory.",
          args: {
            name: "dir",
            default: "dist",
            template: "folders",
          },
        },
      ],
      action({ args: [input], options }) {
        console.log(`${input} -> ${options.get("--output")}`);
        if (options.has("--watch")) {
          console.log("Watch mode enabled.");
        }
      },
    },
    CLI.helpCommand,
    CLI.completion,
  ],
});

CLI.run(spec);
```

`build` defaults to `.` for input and `dist` for output:

```console
$ node demo.ts build
. -> dist
$ node demo.ts build src -o public --watch
src -> public
Watch mode enabled.
```

In the remaining command examples, `demo` stands for `node demo.ts`.

Adding `CLI.help` to the root command's `options` makes `-h` and `--help` available on all its subcommands. The generated help lists the command's arguments and options:

```console
$ demo build --help
Build a project.

Usage:
  demo build [flags] [input]

Arguments:
  input  Source directory. (default: .)

Flags:
  -w, --watch         Watch for changes.
  -o, --output <dir>  Output directory. (default: dist)

Global flags:
  -h, --help          Print a help message
```

Running `demo` without a subcommand displays the CLI's help text, including the available commands and global options. This is the default behavior for a command without an `action`.

`demo help build` displays help for the `build` subcommand. `demo completion <shell>` prints a completion script for the specified shell.

## Performance

In the [benchmarks](https://clo4.net/cli/v6/performance), Commander takes 3.4 to 4.4 times as long as `@clo4/cli` for the same work, and Yargs takes 18.0 to 20.7 times as long.

## License

[MIT](LICENSE)
