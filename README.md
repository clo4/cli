# @clo4/cli

_A magical CLI framework, with no magic._

Build a CLI from plain TypeScript objects. One command definition supplies the parser, inferred action types, help and shell completion. Actions receive strings, or the numbers and choices an argument's parser turns them into, and run your application code.

The package has no runtime dependencies. It supports completion for Bash, Zsh, Fish, PowerShell and Nushell, with static suggestions, file paths and sync or async generators on individual arguments. Large CLIs can load command definitions on demand.

```sh
npm install @clo4/cli
```

The package is ESM-only. Type inference requires TypeScript 6.0 or later.

## Example

Save this as `demo.ts` in a project with `"type": "module"` in `package.json`. Run it with Node.js 24 or later using its [built-in TypeScript support](https://nodejs.org/api/typescript.html#type-stripping).

```ts
import * as CLI from "@clo4/cli";

const spec = CLI.spec({
  name: "demo",
  description: "A small build tool",
  options: [CLI.help],
  subcommands: [
    {
      name: "build",
      description: "Build a project",
      args: {
        name: "input",
        description: "Source directory",
        isOptional: true,
        default: ".",
        template: "folders",
      },
      options: [
        { name: ["-w", "--watch"], description: "Watch for changes" },
        {
          name: ["-o", "--output"],
          description: "Output directory",
          args: {
            name: "dir",
            default: "dist",
            template: "folders",
          },
        },
        {
          name: ["-j", "--jobs"],
          description: "Tasks to run at once",
          args: {
            name: "count",
            default: "4",
            parse: CLI.number({ min: 1, max: 64, int: true }),
          },
        },
      ],
      action({ args: [input], options }) {
        console.log(`${input} -> ${options.get("--output")}, ${options.get("--jobs")} at once`);
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

```console
$ node demo.ts build
. -> dist, 4 at once
$ node demo.ts build src -o public --jobs 8 --watch
src -> public, 8 at once
Watch mode enabled.
$ node demo.ts build --jobs many
Error: Invalid value "many" for --jobs: expected an integer from 1 to 64
```

`CLI.spec` returns the definition unchanged and infers the action's inputs. Here, `input` and the output value are strings because they have defaults, and `--jobs` is a number because its parser is `CLI.number`. TypeScript rejects unknown option names.

An argument's parser runs before the action. Help shows `--jobs` as `(int from 1 to 64, default: 4)`, and every rejected value is reported together with anything else that's wrong with the command line.

`CLI.run` parses the command line and runs the selected action. `demo build --help` and `demo help build` print help for `build`. Running `demo` without a subcommand prints root help.

## Custom completion

Attach a generator to the argument it completes. This option asks application code for deployment targets:

```ts
{
  name: "--target",
  args: {
    name: "target",
    generators: {
      custom: async (tokens) => listTargets(tokens),
    },
  },
}
```

`listTargets` is your function. It receives the command-line tokens and returns strings or `{ name, description }` objects. The library selects the argument and formats suggestions for the shell.

Add `CLI.completion` to the root's subcommands. Generate and load its script at shell startup so completion stays matched to the installed CLI. See [Install shell completion](https://clo4.net/cli/next/install-completion) for shell configuration and [Help and completion](https://clo4.net/cli/next/help-and-completion) for generator details.

## Documentation

Read the [introduction](https://clo4.net/cli/next) or go directly to a topic:

- [Options](https://clo4.net/cli/next/options): names, values, defaults, repetition and relationships.
- [Arguments](https://clo4.net/cli/next/arguments): positional and variadic inputs, and parsing values into numbers and choices.
- [Subcommands](https://clo4.net/cli/next/subcommands): command trees and persistent options.
- [Actions](https://clo4.net/cli/next/actions): input types, errors and exit codes.
- [Help and completion](https://clo4.net/cli/next/help-and-completion): built-ins, suggestions and shell setup.
- [Testing](https://clo4.net/cli/next/testing): validate a spec against the parser's rules.
- [Parser settings](https://clo4.net/cli/next/parser-settings): token parsing, abbreviations and separators.
- [Performance](https://clo4.net/cli/next/performance): benchmarks and loading commands on demand.
- [Choosing a CLI library](https://clo4.net/cli/next/choosing-a-cli-library): features and application responsibilities.

## Performance

The [benchmarks](https://clo4.net/cli/next/performance) measure bundled CLI startup and command execution, excluding Node startup. For the measured workload, Commander takes 3.4–4.4 times as long as `@clo4/cli`, and Yargs takes 18.0–20.7 times as long.

## License

[MIT](LICENSE)
