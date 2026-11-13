# @clo4/cli

A declarative CLI framework: one spec describes a command line, and the parser, help, shell completion and spec checks all read it.

## Language

**Spec**: The root command of a CLI, with everything below it.

**Command**: Any node in a spec, the root included. A **subcommand** is a command below another one.

**Command body**: Everything about a subcommand except what its parent reads before entering it, which is its name, description, and whether it's hidden or persistent. A subcommand's `loadSpec` gives its body when a command line enters it.

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

**Spec check**: An assertion from `./testing` that a spec is one the parser reads the way help and completion present it.
