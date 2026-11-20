# @clo4/cli

A declarative CLI framework: one spec describes a command line, and the parser, help, shell completion and spec checks all read it.

## Language

**Spec**: The root command of a CLI, with everything below it.

**Command**: Any node in a spec, the root included. A **subcommand** is a command below another one.

**Loaded command**: The command a subcommand's `loadSpec` gives when a command line enters it. The parser carries on with a copy of it in the subcommand's place, with what the subcommand sets on top: its name, description, and whether it's hidden or persistent. Neither command is changed. _Avoid_: command body

**Path**: The commands from the root to the selected one.

**Option**: A named token a command accepts, optionally followed by values. Help output calls these flags. _Avoid_: flag (outside help output)

**Persistent option**: An option that the descendants of the command defining it can use too. _Avoid_: global option

**Persistent subcommand**: A subcommand that the descendants of its parent can name too, by exact name only.

**Command scope**: What each name means at one command on a path: which option or subcommand it refers to, and the directives and argument limits in effect there. _Avoid_: option scope

**Shadowed**: Said of a name that a nearer option, a later option, or a subcommand has taken, so it no longer refers to the option that defines it.

**Ref**: A second key an action reads an option by, for an option that shares a name with a different option on a command above or below it. No other option that can be on the same command line uses it, as a ref or as a name.

**Directives**: A command's parsing switches, such as its option arg separators. A subcommand inherits each one until it sets its own.

**Option arg separator**: What joins an option's name to a value in the same token, `=` by default.

**Form**: How one name of an option is written with its value at one command: as a separate token, after a separator, or glued on.

**Argument list**: What a command's or an option's `args` holds: one argument, a list of them, or none. It says how many values the command or option takes, and which defaults fill in for the arguments a use leaves out, once every required one is given.

**Argument's parser**: What an argument's `parse` property holds. It turns the string the user typed into the value the action receives, or rejects it. It's a built-in parser or a Standard Schema from another library. Written as "the argument's parser" or "its parser". _Avoid_: `parse` as a noun, validator, coercion

**Parser description**: What an argument's parser says about the values it takes: the strings it lists, the range of numbers it takes, what help shows, and what completion offers. A built-in parser describes itself, and another Standard Schema is described by the JSON Schema it gives.

**Built-in parser**: A `Parser` object, which is what `number`, `choice`, `seq` and the other parser functions return.

**Command-line parser**: The part of the library that reads the command line against the spec. "The parser" on its own means this one. Where a sentence mentions an argument's parser too, it's written out in full.

**Part**: A piece of a parser: a string that must appear exactly as written, or another parser.

**Atom**: The kind of a parser, such as a number, a choice or a `seq`. It reads the value and describes the parser.

**Pattern**: A parser as help shows it, like `<integer>(s|m|h|d)`.

**Label**: A name that `as` gives a parser. A pattern shows it in the parser's place, like `<width>x<height>`.

**Spec check**: An assertion from `./testing` that a spec is one the parser reads the way help and completion present it.
