# clo4's CLI SDK

`@clo4/cli` is a TypeScript library for building command-line tools. Commands are plain objects that describe accepted arguments and options. Each command can have an action: a function that receives the parsed input. TypeScript types that input from the command's own definition.

Parsing, help and completion need to follow the same argument and option rules. The library reads those rules from the command definitions, with application logic in the action functions.

Startup time matters for commands that exit quickly and for shell completion, which starts the CLI on each request.

```bash
npm install @clo4/cli
```

## Contents

[Example](#example) · [Getting started](#getting-started) · [Help and completion](#help-and-completion) · [Testing](#testing-your-spec) · [Parser settings](#parser-settings) · [Performance](#performance) · [API](#api-and-compatibility) · [License](#license)

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

<details>
<summary>Command-line errors</summary>
<br>

When parsing fails, `CLI.run` writes an error message and usage to stderr and sets the exit code to 1. For misspelled commands or options, the output may suggest a matching name:

```console
$ demo bild
Error: Unknown command 'bild'

    Did you mean 'build'?

Usage:
  demo [flags]

Commands:
  build       Build a project.
  help        Print a help message
  completion  Print a shell completion script

Global flags:
  -h, --help  Print a help message
```

<hr>
</details>

[↑ Contents](#contents) · [Getting started →](#getting-started)

## Getting started

A **spec** is a plain object describing your CLI. `CLI.spec` takes the top-level (root) command and returns it unchanged. `CLI.command` does the same for a command written outside the spec. Both give each action the types of its own command's arguments and options.

For a command line like `demo build src --output dist --watch`:

- `build` selects the command to run.
- `args` describes positional arguments: here, `src` is the input directory.
- `options` describes named inputs: `--output` takes the value `dist`, and `--watch` is a flag with no value.
- The `build` command's `action` receives these parsed arguments and options and runs after parsing succeeds.

In the spec, `args` and `options` define what a command accepts. Inside an action, `args` is an array of positional values, and `options` has methods to read the named inputs. TypeScript knows how many values the command takes and which option names it has. `CLI.run` reads the command line, validates argument counts and option rules, and calls the selected action.

The flag example below is a complete `demo.ts`. Subsequent examples replace its `build` definition. As in the opening example, `demo` stands for `node demo.ts` in command examples.

### Flags

A flag is an option that takes no value. Add it to the command's `options` array, then use `options.has()` in the action to check whether it was given.

```ts
import * as CLI from "@clo4/cli";

const build = CLI.command({
  name: "build",
  options: [
    {
      name: "--debug",
    },
  ],
  action({ options }) {
    console.log(options.has("--debug"));
  },
});

const spec = CLI.spec({
  name: "demo",
  subcommands: [build],
});

CLI.run(spec);
```

```console
$ demo build --debug
true
$ demo build
false
```

A name the command doesn't define, such as `options.has("--debgu")`, is a compile error.

<br>

### Names

An option's `name` accepts a string or an array of aliases. This replacement for `build` accepts both `-v` and `--verbose`; keep the import, root spec and `CLI.run` call from the preceding example:

```ts
const build = CLI.command({
  name: "build",
  options: [
    {
      name: ["-v", "--verbose"],
    },
  ],
  action({ options }) {
    console.log(options.has("--verbose"));
  },
});
```

```console
$ demo build -v
true
$ demo build --verbose
true
```

Include the prefix in each name, such as `-v` or `--verbose`. Names are case-sensitive. Both aliases work when reading an option: `options.has("-v")` and `options.has("--verbose")` return the same result.

Short flags can be grouped: `-abc` is equivalent to `-a -b -c` when all three are flags. An option's `description` appears beside its names in help.

<br>

### Option arguments

An option's `args` describes the value it accepts. Here, `file` labels that value in help. The action reads the supplied value with `options.get()`:

```ts
const build = CLI.command({
  name: "build",
  options: [
    {
      name: ["-o", "--output"],
      args: {
        name: "file",
      },
    },
  ],
  action({ options }) {
    console.log(options.get("--output"));
  },
});
```

```console
$ demo build -o out.js
out.js
$ demo build
undefined
```

The parser accepts `-o out.js`, `-oout.js` and `--output=out.js`. Supplying `--output` without a value is an error. `options.get("--output")` has the type `string | undefined`, since the option can be omitted. Setting `isRequired: true` on the option makes omitting it an error, and the type becomes `string`.

<br>

### Positional arguments

A command's `args` describes positional arguments: values supplied without an option name. It accepts one argument definition or an array. Arguments are required by default; `isOptional: true` allows an argument to be omitted. The action receives their values in order:

```ts
const build = CLI.command({
  name: "build",
  args: [
    {
      name: "source",
    },
    {
      name: "destination",
      isOptional: true,
    },
  ],
  action({ args: [source, destination] }) {
    console.log(source, destination);
  },
});
```

```console
$ demo build src dist
src dist
$ demo build src
src undefined
```

In the action, `source` is a `string` and `destination` is `string | undefined`. Required arguments must come before optional arguments. Help shows this example as `<source> [destination]`.

The `--` separator makes all remaining words positional arguments, including words that match options or subcommands. For example, `demo build -- --help` passes `"--help"` as the source.

<br>

### Defaults

The remaining examples in Getting started show fields inside `build`. Replace its existing `args`, `options` and `action` with the fields shown. Examples that change the root spec identify it explicitly.

Defaults are set on argument definitions. The opening example gives its optional `input` argument the default `"."`. For an option with a required value, the default applies when the option is omitted:

```ts
options: [
  {
    name: "--port",
    args: {
      name: "port",
      default: "8080",
    },
  },
],
action({ options }) {
  console.log(options.get("--port"));
},
```

```console
$ demo build
8080
$ demo build --port 3000
3000
```

With a default, `options.get("--port")` has the type `string`.

<details>
<summary>Defaults for optional option values</summary>
<br>

When `--port` is omitted, `options.get("--port")` returns `"8080"`. The option still counts as absent: `options.has("--port")` is `false` and `options.count("--port")` is `0`. Supplying `--port` without a value is an error.

With `isOptional: true` on an option argument, the option can be supplied without a value. Its default then supplies the missing value. When the option is omitted entirely, `options.get()` returns `undefined`:

```ts
options: [
  {
    name: "--inspect",
    args: {
      name: "port",
      isOptional: true,
      default: "9229",
    },
  },
],
action({ options }) {
  console.log(options.get("--inspect"));
},
```

```console
$ demo build --inspect
9229
$ demo build --inspect=9000
9000
$ demo build
undefined
```

Defaults are strings and appear in help automatically. A positional argument with a default must be optional. Defaults for an omitted option don't satisfy required options or dependencies. [Spec validation](#testing-your-spec) catches defaults the parser cannot use.

<hr>
</details>

<br>

### Variadic arguments

A variadic argument accepts one or more values. Set `isVariadic: true` on the last argument; its values appear in the same array as the other positional arguments.

```ts
args: {
  name: "files",
  isVariadic: true,
},
action({ args }) {
  console.log(args.join(", "));
},
```

```console
$ demo build index.ts utils.ts
index.ts, utils.ts
```

An argument can be both optional and variadic to accept zero or more values. Option arguments support the same fields, including `isOptional` and `isVariadic`.

<br>

### Repeated options

Setting `isRepeatable: true` on an option allows it to be supplied any number of times. `options.all()` returns the collected values in order.

```ts
options: [
  {
    name: "--tag",
    args: {
      name: "tag",
    },
    isRepeatable: true,
  },
],
action({ options }) {
  console.log(JSON.stringify(options.all("--tag")));
},
```

```console
$ demo build --tag dev --tag latest
["dev","latest"]
$ demo build
[]
```

Setting `isRepeatable` to an integer greater than 1 limits how many times the option can be supplied. For example, `isRepeatable: 2` allows at most two `--tag` options:

```ts
options: [
  {
    name: "--tag",
    description: "Add a tag.",
    args: {
      name: "tag",
    },
    isRepeatable: 2,
  },
],
action({ options }) {
  console.log(JSON.stringify(options.all("--tag")));
},
```

```console
$ demo build --tag dev --tag latest
["dev","latest"]
$ demo build --tag dev --tag latest --tag extra
Error: Too many repetitions

Usage:
  demo build [flags]

Flags:
  --tag <tag>  Add a tag.
```

Without `isRepeatable`, repeating an option replaces its previous values.

For options with arguments, `options.count(name)` counts collected values. For repeatable flags without arguments, it counts occurrences of the flag.

<table><tbody><tr><td>💡</td><td>
<!-- <tip> -->
Use a repeatable <code>-v</code> flag to let users increase logging detail: <code>-v</code> for diagnostics, <code>-vv</code> for debug output, and <code>-vvv</code> for tracing. Use <code>options.count("-v")</code> to select the logging level in your action.
<!-- </tip> -->
</td></tr></tbody></table><br>

### Subcommands

Each subcommand has its own name, arguments, options and action. Its definition goes in the parent command's `subcommands` array. This example adds `clean` to the root spec, with `c` as an alias:

```ts
subcommands: [
  {
    name: ["clean", "c"],
    description: "Remove build output.",
    action() {
      console.log("Cleaning up.");
    },
  },
],
```

```console
$ demo clean
Cleaning up.
$ demo c
Cleaning up.
```

A command without an action prints its help. Set `hidden: true` to leave a command or option out of help and completion; typing its exact name still works.

Setting `requiresSubcommand: true` on a command prevents it from accepting positional arguments. When no subcommand is supplied, the command's action runs if defined; otherwise, it displays help.

A CLI with dozens of commands can [load each command when it's used](#loading-commands-on-demand).

<br>

### Global options

An option normally belongs to the command that defines it. With `isPersistent: true`, descendant commands inherit it. Here, `--verbose` is defined on the root spec and is also available to `build`:

```ts
options: [
  {
    name: "--verbose",
    isPersistent: true,
  },
],
subcommands: [
  {
    name: "build",
    action({ options }) {
      console.log(options.has("--verbose"));
    },
  },
],
```

```console
$ demo --verbose build
true
$ demo build --verbose
true
```

Help lists persistent options under “Global flags”. When `CLI.help` is added to the root spec, every descendant command inherits `--help`.

<details>
<summary>Options that share a name</summary>
<br>

A subcommand's option can take a name that an inherited option also has. Here `-v` means `--verbose` on `demo` and `--version` on `build`. Both store their values under `-v`, so each needs a `ref`, a second key that only it uses:

```ts
options: [
  {
    name: ["-v", "--verbose"],
    isPersistent: true,
    ref: "verbose",
  },
],
subcommands: [
  {
    name: "build",
    options: [
      {
        name: ["-v", "--version"],
        ref: "version",
      },
    ],
    action({ options }) {
      console.log(options.has("verbose"), options.has("version"));
    },
  },
],
```

```console
$ demo -v build
true false
$ demo build -v
false true
```

`options.has("-v")` is `true` in both runs, because it reads whichever option used the name last. [Spec validation](#testing-your-spec) requires a `ref` on both options, and rejects one on an option that shares no name.

<hr>
</details>

<br>

### Option relationships

`dependsOn` lists options that must also be supplied. `exclusiveOn` lists options that cannot be used together.

```ts
options: [
  {
    name: "--json",
    exclusiveOn: ["--quiet"],
  },
  {
    name: "--quiet",
  },
  {
    name: "--sign",
    dependsOn: ["--output"],
  },
  {
    name: "--output",
    args: {
      name: "file",
    },
  },
],
```

`--json --quiet` fails in either order. `--sign` fails unless the user also supplies `--output`. Names in these lists include their prefixes. Defaults don't count as supplied options.

<br>

### Actions & errors

Actions receive argument values as strings. Conversion and validation happen inside the action. If it throws an `Error`, `CLI.run` prints its message to stderr and sets the exit code to 1.

```ts
options: [
  {
    name: "--port",
    args: {
      name: "port",
      default: "8080",
    },
  },
],
action({ options }) {
  const port = Number(options.get("--port"));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535");
  }
  console.log(`Port: ${port}`);
},
```

```console
$ demo build --port 3000
Port: 3000
$ demo build --port nope
Error: Port must be an integer between 1 and 65535
```

An action can return a number to set the exit code, or return nothing for success (0). Async actions are awaited. `CLI.run` sets `process.exitCode` to that code, limited to the range 0–255.

<details>
<summary>Option actions and additional action parameters</summary>
<br>

An option can have an action, too. This runs **instead of** the command's action:

```ts
options: [
  {
    name: "--version",
    action: () => console.log("1.0.0"),
  },
],
```

When several supplied options have actions, the last one is selected. It bypasses checks for positional argument counts, required options and option relationships. For that reason an option's action receives `args` as `string[]` and `options.get()` as `string | undefined`. Its option names are still checked, like a command's. This allows `--help` to display usage without supplying required inputs. Unknown options and malformed option values still produce parsing errors.

Actions also receive:

- `path`: the command objects from the root spec to the selected command.
- `argSeparatorIndex`: the index in `args` where values after `--` begin, or `-1` if `--` was not supplied.
- `help(config?)`: a function that returns help text for the selected command.

`options.options` exposes the underlying `Map<string, string[]>`. Supplied options have entries for every alias; omitted options have no entry, including those with defaults.

To report an error without throwing, call `CLI.printError("message")` and return 1.

The action's `help()` function accepts `description: false` to omit the command description and `usage: false` to omit the usage line. `didYouMean: { input, choices }` adds a spelling suggestion. To render help for another command, pass its array of command objects as `path`.

`CLI.run` reads `process.argv.slice(2)` by default. Pass `argv` to supply the command line directly, for example `CLI.run(spec, { argv: ["build", "src"] })`. It returns a promise of the exit code and never calls `process.exit`. With `setExitCode: false`, it leaves `process.exitCode` alone.

<hr>
</details>

### Types in actions

Each action is typed from its own command, at any depth. Its `options` also accepts the persistent options of the commands above it:

```ts
const spec = CLI.spec({
  name: "demo",
  options: [{ name: "--verbose", isPersistent: true }],
  subcommands: [
    {
      name: "build",
      args: [{ name: "source" }, { name: "destination", isOptional: true }],
      options: [{ name: "--output", args: { name: "dir", default: "dist" } }],
      action({ args: [source, destination], options }) {
        source; // string
        destination; // string | undefined
        options.get("--output"); // string
        options.has("--verbose"); // inherited from demo
        options.has("--outptu"); // compile error
      },
    },
  ],
});
```

An action in a command made with `CLI.command` knows that command's options only, since the commands above it aren't in the call.

These types need TypeScript 6.0 or later.

[← Example](#example) · [↑ Contents](#contents) · [Help and completion →](#help-and-completion)

## Help and completion

`CLI.help` is a help option; `CLI.helpCommand` and `CLI.completion` are subcommands. Add them to the root spec's `options` and `subcommands` arrays:

```ts
options: [CLI.help],
subcommands: [CLI.helpCommand, CLI.completion, /* your commands */],
```

Running `demo --help` displays help for the top-level command. Both `demo build --help` and `demo help build` display help for the `build` subcommand. For nested subcommands, include the full command path: `demo help remote add`. Shell completion offers subcommand names after `help`, so `demo help remote <Tab>` lists the subcommands of `remote`.

The built-ins are plain objects. To customise one, copy it with object spread: `{ ...CLI.help, description: "Show help" }`. Setting `isPersistent: true` on `CLI.helpCommand` makes it available within descendant commands, so `demo build help` displays help for `build`.

Persistent subcommands match exact names and are omitted from descendant help. If a descendant defines a subcommand with the same name, that local definition takes precedence.

To pass an inherited command's name as the first positional argument, put `--` before it. For example, `demo build -- help` passes `"help"` as the input directory.

<br>

### Completion suggestions

An argument's `suggestions` field supplies values offered by shell completion. It works on both positional and option arguments:

```ts
options: [
  {
    name: "--mode",
    args: {
      name: "mode",
      suggestions: ["debug", "release"],
    },
  },
],
```

Suggestions don't restrict accepted values. Validate allowed values in the action if the option must accept only a fixed set.

On an argument, `template: "filepaths"` completes files and directories; `template: "folders"` completes directories only.

Dynamic suggestions come from `generators.custom`. Here, `listTargets(tokens)` is an application function that returns the currently available targets:

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

Static suggestions and generator results can be strings or `{ name, description }` objects. A generator receives the words after the program name, ending with the partial value being completed. For `--target=prod`, its last token is `"prod"`. An argument can have multiple generators by supplying an array.

Each completion request starts a new CLI process. The completion resolver follows the parser's rules for option scope, conflicts and repeat limits. Put application initialisation inside actions to avoid running it on completion requests.

The completion scripts set `SHELL_COMPLETION_GENERATOR` to the shell's name, such as `bash` or `nushell`, while the CLI answers a completion request. Code that runs before `CLI.run` can check it to skip work that completion doesn't need:

```ts
if (!process.env.SHELL_COMPLETION_GENERATOR) {
  await loadPlugins();
}
```

<details>
<summary>Install shell completion</summary>
<br>

`demo completion` lists the supported shells. Use `demo completion <shell>` to print a script, replacing `demo` with your installed command's name.

**Bash:** save the script and source it from `~/.bashrc`.

```sh
demo completion bash > ~/.demo-completion.bash
# Add to ~/.bashrc: source ~/.demo-completion.bash
```

**Zsh:** save into a directory on `fpath`, before `compinit` runs.

```zsh
mkdir -p ~/.zsh/completions
demo completion zsh > ~/.zsh/completions/_demo
# Add to ~/.zshrc before compinit: fpath=(~/.zsh/completions $fpath)
```

If needed, enable [Zsh's completion system](https://zsh.sourceforge.io/Doc/Release/Completion-System.html#Initialization) with `autoload -Uz compinit; compinit` after setting `fpath`.

**Fish:** save into its completion directory.

```fish
mkdir -p ~/.config/fish/completions
demo completion fish > ~/.config/fish/completions/demo.fish
```

**PowerShell:** append to [your profile](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_profiles), creating it if needed.

```powershell
if (!(Test-Path $PROFILE)) { New-Item -ItemType File -Path $PROFILE -Force }
demo completion powershell >> $PROFILE
```

**Nushell:** save into a [user autoload directory](https://www.nushell.sh/book/configuration.html#configuration-overview).

```nu
mkdir ($nu.user-autoload-dirs | first)
demo completion nushell | save -f ($nu.user-autoload-dirs | first | path join demo.nu)
```

Start a new shell after installing.

<hr>
</details>

[← Getting started](#getting-started) · [↑ Contents](#contents) · [Testing your spec →](#testing-your-spec)

## Testing your spec

`testSpec` validates the structure of a spec, including names, argument order, defaults and option references. These checks catch mistakes that TypeScript's types cannot express.

Export your spec from a module that does not call `CLI.run`, such as `src/spec.ts`, so importing it in a test does not run the CLI. A Vitest test can import the spec and validate it:

```ts
import { test } from "vitest";
import { testSpec } from "@clo4/cli/testing";
import { spec } from "../src/spec.ts";

test("CLI spec is valid", () => testSpec(spec)());
```

`testSpec(spec)` returns an async function that runs the checks and throws on failure. Return its promise from your test callback, as above, or await it inside an async test.

The examples above leave out some descriptions to keep them short. By default, validation checks that every command and option has a description and that description lines fit within 68 characters.

<details>
<summary>Validation options</summary>
<br>

The second argument configures validation. `allowNoDescription: true` disables the check for missing command and option descriptions:

```ts
await testSpec(spec, {
  allowNoDescription: true,
})();
```

Two other options disable individual checks:

- `allowLongDescriptionLines`: descriptions can have lines over 68 characters.
- `allowMatchingSubcommandPrefixAndArgs`: a command can combine positional arguments with subcommands matched by prefix.

All three default to `false`. `namingStyle: "function"` uses check names such as `assertNamesReadBack` in step-based test output.

The testing entry point also exports `test` as an alias of `testSpec`, and the [types of its options](src/testing.ts).

<hr>
</details>

[← Help and completion](#help-and-completion) · [↑ Contents](#contents) · [Parser settings →](#parser-settings)

## Parser settings

A command's `parserDirectives` field controls how the parser reads its command line. By default, options can appear before or after positional arguments, subcommands match exact names or aliases, and attached option values use `=`.

A setting applies to the command that defines it and is inherited by its descendants. A subcommand can override a boolean setting with `false`, or provide its own `optionArgSeparators`.

Each example below defines a separate root `spec`. Keep the `import * as CLI from "@clo4/cli"` and `CLI.run(spec)` from the opening example.

### Options before arguments

Normally, `demo node --verbose` reads `--verbose` as an option and `node` as a positional argument. For a wrapper around another program, you may want every word after `node` passed through instead.

With `optionsMustPrecedeArguments: true`, the first positional argument ends option parsing:

```ts
const spec = CLI.spec({
  name: "demo",
  parserDirectives: {
    optionsMustPrecedeArguments: true,
  },
  args: {
    name: "command",
    isVariadic: true,
  },
  options: [
    {
      name: "--verbose",
    },
  ],
  action({ args, options }) {
    console.log(`verbose: ${options.has("--verbose")}`);
    console.log(JSON.stringify(args));
  },
});
```

```console
$ demo --verbose node --trace-warnings
verbose: true
["node","--trace-warnings"]
$ demo node --verbose
verbose: false
["node","--verbose"]
```

With the directive, `demo node --verbose` treats `--verbose` as a positional value. With default settings, that command would print `verbose: true` and `["node"]`. To end option parsing for a single invocation, use `--`, for example `demo -- node --verbose`.

<br>

### Abbreviated subcommands

Subcommands normally require an exact name or alias. `subcommandsMatchUniquePrefix: true` also accepts a prefix when it identifies just one subcommand:

```ts
const spec = CLI.spec({
  name: "demo",
  parserDirectives: {
    subcommandsMatchUniquePrefix: true,
  },
  subcommands: [
    {
      name: "install",
      action: () => console.log("Installing."),
    },
    {
      name: "info",
      action: () => console.log("Project information."),
    },
  ],
});
```

```console
$ demo ins
Installing.
$ demo inf
Project information.
```

Without the directive, `ins` and `inf` are unknown commands. `demo in` still fails because both names begin with `in`: `Ambiguous command 'in', could be: install, info`.

Hidden and inherited subcommands still require exact names.

When a command accepts both positional arguments and abbreviated subcommands, a word could be interpreted as either. Spec validation rejects this combination by default.

<br>

### Option value separators

By default, `--port=3000` attaches a value with `=`, and `--port 3000` supplies it as the next word. `optionArgSeparators` changes which separators are accepted for attached values.

This spec adds `:` while keeping `=`:

```ts
const spec = CLI.spec({
  name: "demo",
  parserDirectives: {
    optionArgSeparators: [":", "="],
  },
  options: [
    {
      name: ["-p", "--port"],
      args: {
        name: "port",
      },
    },
  ],
  action({ options }) {
    console.log(options.get("--port"));
  },
});
```

```console
$ demo --port:3000
3000
$ demo --port=4000
4000
$ demo --port 5000
5000
```

Without the directive, `--port:3000` is an unknown option. `optionArgSeparators: ":"` accepts only `:` as a separator. `[]` disables separators; short attached values such as `-p3000` still work.

<details>
<summary>Requiring a separator</summary>
<br>

Setting `requiresSeparator: true` on an option requires its value to be attached using an enabled separator. This spec uses the default separator, `=`. It accepts `--port=3000` and rejects `--port 3000`:

```ts
const spec = CLI.spec({
  name: "demo",
  options: [
    {
      name: "--port",
      args: {
        name: "port",
      },
      requiresSeparator: true,
    },
  ],
  action({ options }) {
    console.log(options.get("--port"));
  },
});
```

A string requires that particular separator: `requiresSeparator: ":"` accepts `--port:3000` and rejects `--port=3000`. The separator must also be enabled in `parserDirectives.optionArgSeparators`.

<hr>
</details>

<br>

### Literal option names

Normally, `-abc` is read as chained short options: `-a -b -c`. With `flagsArePosixNoncompliant: true`, names are read literally, so you can define an option such as `-name`:

```ts
const spec = CLI.spec({
  name: "demo",
  parserDirectives: {
    flagsArePosixNoncompliant: true,
  },
  args: {
    name: "paths",
    isOptional: true,
    isVariadic: true,
  },
  options: [
    {
      name: "-name",
      args: {
        name: "pattern",
      },
    },
  ],
  action({ args, options }) {
    console.log(`pattern: ${options.get("-name")}`);
    console.log(JSON.stringify(args));
  },
});
```

```console
$ demo src -name '*.ts'
pattern: *.ts
["src"]
$ demo -unknown
pattern: undefined
["-unknown"]
```

This setting also treats unrecognised option-like words as positional arguments. Without it, `-unknown` produces an option error. The command must still declare enough positional arguments to accept these values.

<table><tbody><tr><td>💡</td><td>
<!-- <tip> -->
Quote glob patterns when you want the CLI to receive the pattern itself. In <code>demo src -name '*.ts'</code>, the quotes prevent the shell from expanding <code>*.ts</code> into matching filenames before the CLI receives it.
<!-- </tip> -->
</td></tr></tbody></table>

[← Testing your spec](#testing-your-spec) · [↑ Contents](#contents) · [Performance →](#performance)

## Performance

The [benchmarks](bench/run.ts) compare command execution and startup overhead with other CLI libraries and Node's built-in `parseArgs`. Run them with `pnpm bench`; [CI also records results](.github/workflows/cli-bench.yml).

<details>
<summary>Performance comparison</summary>
<br>

Each value is relative to `@clo4/cli` in the same run: `2.5x` means the library took 2.5 times as long for the measured work. Lower is better. The run was on an Apple M3 Pro.

| Library                                 | Apple M3 Pro |
| --------------------------------------- | ------------ |
| `node:util` parseArgs, hand-written CLI | 1.3x         |
| sade                                    | 1.3x         |
| Cac                                     | 1.4x         |
| citty                                   | 1.8x         |
| brocli                                  | 2.0x         |
| Stricli                                 | 2.3x         |
| gunshi                                  | 2.5x         |
| Cliffy                                  | 3.0x         |
| Commander                               | 3.4x         |
| clerc                                   | 3.6x         |
| cmd-ts                                  | 4.0x         |
| Clipanion                               | 4.4x         |
| Optique                                 | 13.9x        |
| oclif                                   | 16.2x        |
| Effect                                  | 18.2x        |
| Yargs                                   | 20.7x        |

The benchmark runs seven tasks, including help output, nested commands and argument errors. Timing starts before the bundled CLI is loaded and ends when the process exits. Node's own startup time is excluded.

For each library, the score is the geometric mean of its seven task medians, minus the cost of loading an empty bundle. The table compares those scores.

</details>

### Loading commands on demand

A spec is built in full every time the CLI starts, even though one run uses one command. Give a subcommand a `loadSpec` function and the rest of that command is built only when a command line enters it:

```ts
subcommands: [
  {
    name: "remote",
    description: "Manage remotes.",
    loadSpec: () => import("./remote.ts").then((module) => module.default),
  },
],
```

```ts
// remote.ts
import * as CLI from "@clo4/cli";

export default CLI.command({
  requiresSubcommand: true,
  subcommands: [
    { name: "add", description: "Add a remote.", args: { name: "url" }, action: addRemote },
    { name: "list", description: "List remotes.", action: listRemotes },
  ],
});
```

The command keeps its `name`, `description`, `hidden` and `isPersistent`, because its parent's help and completion show it before it loads. Everything else goes in the body: `args`, `options`, `subcommands`, `action`, `requiresSubcommand` and `parserDirectives`. A subcommand in a body can have a `loadSpec` of its own.

`loadSpec` runs once, the first time the parser, help or completion enters the command. `demo remote add`, `demo remote --help`, `demo help remote` and pressing Tab after `demo remote` all load `remote` and nothing else. `demo --help` loads nothing.

`loadSpec` can also return the body directly, which keeps the command in the same file and the parser synchronous:

```ts
loadSpec: () => CLI.command({ requiresSubcommand: true, subcommands: [/* ... */] }),
```

Write the `import()` in your own file with a literal path, as above, so a bundler can find the file and emit it as a separate chunk.

Call `CLI.run` without `await`, as every example here does. A command's file can't import the library from an entry that is waiting on a top-level `await`, so a bundler moves the library into a file of its own, and every run loads one more file.

`testSpec` loads every command before it checks the spec.

#### When loading on demand is faster

Loading from another file costs about 0.3 ms, the time Node takes to read one more file. It's faster than building the whole spec from about 50 commands up, which is also about when a spec gets easier to maintain as a file per command group. Returning the body from the same file is faster from about 25 commands, and costs 0.03 ms below that.

These times are for running one command of a bundled CLI whose commands each take 6 options, on an Apple M3 Pro. They leave out Node's own startup and the time it spends setting up stdout.

| Commands | No `loadSpec` | Body from the same file | Body from a file per group |
| -------- | ------------- | ----------------------- | -------------------------- |
| 10       | 1.6 ms        | 1.7 ms                  | 1.9 ms                     |
| 50       | 1.9 ms        | 1.9 ms                  | 2.0 ms                     |
| 100      | 2.4 ms        | 2.2 ms                  | 2.0 ms                     |
| 1,000    | 12.9 ms       | 7.8 ms                  | 2.3 ms                     |

The benchmark compares large CLIs in two forms, one file and a file per group. Each form has a table for each kind of work: running a command, root help, a group's help, and an unknown command. Each library is written the way its own docs show for that form, and a hand-written `parseArgs` CLI shows the least a CLI can do. In one file, @clo4/cli returns each group's body from `loadSpec`. The benchmark also records @clo4/cli without `loadSpec`.

- **One file:** @clo4/cli, Commander, Yargs, citty, sade, Cliffy, Stricli, gunshi and the `parseArgs` CLI. sade has no command groups, so it has no group help.
- **A file per group:** @clo4/cli, citty, Cliffy, Stricli and gunshi, whose docs show how to load code from another file when a command line needs it, and the `parseArgs` CLI, which uses `import()`. Stricli and gunshi keep every command's definition in the entry and load only its action.

citty and Cliffy load every group's file to print root help, and citty does the same for an unknown command. Their group files import the library, so the bundler moves the library into a shared chunk that every run also loads.

oclif has no large CLI, because it loads each command from its own file through a manifest, which a single bundle can't reproduce. Cac, Clipanion, Effect, Optique, clerc, cmd-ts and brocli have no large CLI yet.

Help times are for output piped to another program. At a terminal, Node takes longer to set up `process.stdout`, which @clo4/cli doesn't use for help.

[← Parser settings](#parser-settings) · [↑ Contents](#contents) · [API and compatibility →](#api-and-compatibility)

## API and compatibility

The package uses ECMAScript modules (ESM), includes TypeScript declarations and has no runtime dependencies. Its named runtime exports are `run`, `spec`, `command`, `printError`, `help`, `helpCommand` and `completion`. The default export is an object containing those same seven values.

Public types include `Spec`, `Subcommand`, `Option`, `Arg` and `ActionInit`. The [type definitions](src/types.ts) document each field; the [entry point](src/index.ts) lists all exports.

The runtime API follows semantic versioning. The testing module may introduce stricter validation rules in minor or patch releases to catch incorrect or undefined behavior.

[← Performance](#performance) · [↑ Contents](#contents) · [License →](#license)

## License

[MIT](LICENSE)

[← API and compatibility](#api-and-compatibility) · [↑ Contents](#contents)
