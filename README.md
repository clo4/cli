# @clo4/cli

_A magical CLI framework, with no magic._

Build a CLI from plain TypeScript objects. One command definition supplies the parser, inferred action types, help and shell completion. Actions receive strings and run your application code.

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
        { name: ["-w", "--watch"], description: "Watch for changes." },
        {
          name: ["-o", "--output"],
          description: "Output directory.",
          args: { name: "dir", default: "dist", template: "folders" },
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

```console
$ node demo.ts build
. -> dist
$ node demo.ts build src -o public --watch
src -> public
Watch mode enabled.
```

`CLI.spec` returns the definition unchanged and infers the action's inputs. Here, `input` and the output value are strings because they have defaults. TypeScript rejects unknown option names.

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

Add `CLI.completion` to the root's subcommands. Generate and load its script at shell startup so completion stays matched to the installed CLI. See [Install shell completion](https://clo4.net/cli/v6/install-completion) for shell configuration and [Help and completion](https://clo4.net/cli/v6/help-and-completion) for generator details.

## Documentation

Read the [introduction](https://clo4.net/cli/v6) or go directly to a topic:

- [Options](https://clo4.net/cli/v6/options): names, values, defaults, repetition and relationships.
- [Arguments](https://clo4.net/cli/v6/arguments): positional and variadic inputs.
- [Subcommands](https://clo4.net/cli/v6/subcommands): command trees and persistent options.
- [Actions](https://clo4.net/cli/v6/actions): input types, validation, errors and exit codes.
- [Help and completion](https://clo4.net/cli/v6/help-and-completion): built-ins, suggestions and shell setup.
- [Testing](https://clo4.net/cli/v6/testing): validate a spec against the parser's rules.
- [Parser settings](https://clo4.net/cli/v6/parser-settings): token parsing, abbreviations and separators.
- [Performance](https://clo4.net/cli/v6/performance): benchmarks and loading commands on demand.
- [Choosing a CLI library](https://clo4.net/cli/v6/choosing-a-cli-library): features and application responsibilities.

## Performance

The [benchmarks](https://clo4.net/cli/v6/performance) measure bundled CLI startup and command execution, excluding Node startup. For the measured workload, Commander takes 3.4–4.4 times as long as `@clo4/cli`, and Yargs takes 18.0–20.7 times as long.

## License

[MIT](LICENSE)
