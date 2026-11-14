# clo4's CLI SDK

`@clo4/cli` is a TypeScript library for building command-line tools. Commands are plain objects that describe accepted arguments and options. Each command can have an action: a function that receives the parsed input. TypeScript types that input from the command's own definition.

Parsing, help and completion need to follow the same argument and option rules. The library reads those rules from the command definitions, with application logic in the action functions.

Startup time matters for commands that exit quickly and for shell completion, which starts the CLI on each request.

```bash
npm install @clo4/cli
```

## Documentation

The full documentation is at [clo4.github.io/cli](https://clo4.github.io/cli/).

- [Options](https://clo4.github.io/cli/v6/options): flags, names, values, defaults, repeats and relationships
- [Arguments](https://clo4.github.io/cli/v6/arguments): positional and variadic arguments
- [Subcommands](https://clo4.github.io/cli/v6/subcommands): nested commands and global options
- [Actions](https://clo4.github.io/cli/v6/actions): errors, exit codes and types
- [Help and completion](https://clo4.github.io/cli/v6/help-and-completion): the built-in help and shell completion
- [Testing](https://clo4.github.io/cli/v6/testing): checks for mistakes that types can't express
- [Parser settings](https://clo4.github.io/cli/v6/parser-settings): changes to how a command line is read
- [Performance](https://clo4.github.io/cli/v6/performance): benchmarks and loading commands on demand

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

In the [benchmarks](https://clo4.github.io/cli/v6/performance), Commander takes 3.4 to 4.4 times as long as `@clo4/cli` for the same work, and Yargs takes 18.0 to 20.7 times as long.

## License

[MIT](LICENSE)
