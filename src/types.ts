/**
 * Declarative CLI spec types.
 *
 * The schema is intentionally small: define commands, positional args, options,
 * and actions. Runtime values from argv are always strings.
 *
 * @module
 */

declare const kind: unique symbol;

/** An array with at least one value in it. */
export type NonEmptyArray<T> = readonly [T, ...T[]];

/** A single value, or an array with at least two values. */
export type SingleOrArray<T> = T | readonly [T, T, ...T[]];

/** A single value, or an array with either zero or at least two values. */
export type SingleOrArrayOrEmpty<T> = T | [] | readonly [T, T, ...T[]];

/**
 * An action associated with a subcommand or option.
 *
 * Actions can be sync or async. Returning `undefined` is treated as exit code 0.
 */
export interface Action {
  (init: ActionInit): Promise<number | void> | number | void;

  /**
   * This property never exists. It prevents accidental structural assignment
   * between otherwise compatible exported interfaces.
   *
   * @ignore
   */
  [kind]?: "Action";
}

/** A command path, starting with the root spec. */
export type CommandPath = readonly [Spec, ...Subcommand[]];

/** Access parsed options. */
export interface OptionArgs {
  /** Escape hatch: the underlying map of option names to values. */
  readonly options: Map<string, string[]>;

  /**
   * Read all values collected for an option, in order.
   *
   * For an omitted option, return consecutive argument defaults from the
   * first argument. Return an empty array if the first argument is optional
   * or has no default. A repeatable option collects values from every use.
   */
  all(name: string): string[];

  /**
   * Read the first value of an option.
   *
   * For an omitted option, return its first argument's default only when
   * that argument is required. Otherwise return `undefined`.
   */
  get(name: string): string | undefined;

  /** Return whether the option was supplied. Defaults do not count. */
  has(name: string): boolean;

  /**
   * Count supplied values. For a repeatable flag, count occurrences instead.
   *
   * An option with multiple arguments can contribute several values per use.
   * An omitted option returns 0, even when it has defaults.
   */
  count(name: string): number;
}

/**
 * Input for an action.
 *
 * `spec` and `command` infer more specific argument and option types for
 * command actions. Option actions use broader types because they can run
 * without satisfying required inputs.
 */
export interface ActionInit {
  /** Options found for this invocation. */
  options: OptionArgs;

  /** Positional arguments found for the selected command. */
  args: string[];

  /**
   * Commands from the root to the selected command. A loaded command can be
   * a copy of its definition. Do not rely on object identity.
   */
  path: CommandPath;

  /** Index of the `--` argument separator, or -1 if it was not supplied. */
  argSeparatorIndex: number;

  /**
   * Return help text for the selected command, or for `config.path`.
   *
   * This method is synchronous. An alternative path with an unloaded async
   * `loadSpec` throws an error. The action's own path is already loaded.
   */
  help(config?: {
    /** Include the command description? Default: true. */
    description?: boolean;

    /** Include the usage summary? Default: true. */
    usage?: boolean;

    /** Suggest the closest choice for an incorrect input. */
    didYouMean?: {
      input: string;
      /** Names to suggest. The names in one array are one command or option. */
      choices: readonly (string | readonly string[])[];
    };

    /** Alternative command path to render help for. */
    path?: NonEmptyArray<Subcommand>;
  }): string;
}

/**
 * The root command of a CLI. Its name is a single string.
 *
 * It accepts the fields of a subcommand except `loadSpec`. Use `spec` to
 * infer action types from a root definition.
 */
export interface Spec extends Omit<Subcommand, "name" | "loadSpec"> {
  /** Name of the CLI. */
  name: string;
}

/**
 * A command definition. Commands can nest through `subcommands`.
 *
 * Use `command` for a separately defined command with inferred action types.
 * A parent action does not run when a child command is selected.
 */
export interface Subcommand {
  /**
   * A case-sensitive name or list of aliases. Use a string for one name and
   * an array for two or more.
   */
  name: SingleOrArray<string>;

  /** Description shown in help. */
  description?: string;

  /** Positional arguments, in order. Use an object for one or an array for two or more. */
  args?: SingleOrArray<Arg>;

  /** Options accepted by this command. */
  options?: NonEmptyArray<Option>;

  /** Subcommands of this command. */
  subcommands?: NonEmptyArray<Subcommand>;

  /**
   * Parsing rules for this command. Each field is inherited independently.
   * A descendant can override a boolean with `false` or replace the separator list.
   */
  parserDirectives?: {
    /**
     * Read option names literally instead of chaining short names. Unknown
     * option-like tokens become positional arguments. Default: `false`.
     */
    flagsArePosixNoncompliant?: boolean;

    /**
     * Stop option parsing after the first positional argument. Later tokens,
     * including `--`, are positional values. Default: `false`.
     */
    optionsMustPrecedeArguments?: boolean;

    /**
     * Separators for attached option values. Default: `"="`. A child
     * replaces the inherited list. An empty array disables separators,
     * but short attached forms such as `-p3000` still work.
     */
    optionArgSeparators?: SingleOrArrayOrEmpty<string>;

    /**
     * Accept an unambiguous prefix of a visible local subcommand name.
     * Hidden and inherited subcommands require exact names. Default: `false`.
     */
    subcommandsMatchUniquePrefix?: boolean;
  };

  /** Omit this command from help and completion. Its exact names still work. */
  hidden?: true;

  /**
   * Allow descendant commands to use this command as a subcommand too, like
   * `{ ...helpCommand, isPersistent: true }`. There it only matches its exact
   * name, a descendant's own subcommand with the same name wins, and help
   * doesn't list it. Where a descendant takes positional arguments, its first
   * argument can't be this command's name without `--` before it.
   */
  isPersistent?: true;

  /**
   * Disallow positional arguments on this command. Omitting a subcommand
   * still runs this command's action, or prints help when it has no action.
   */
  requiresSubcommand?: true;

  /**
   * Action to run when this command is selected. A command without an action
   * prints its help.
   */
  action?: Action;

  /**
   * Give this command in full when a command line enters it, so a large CLI
   * only builds the commands it uses. The parser, help and completion carry
   * on with the loaded command in place of this one. Neither object is
   * changed, and `loadSpec` is called once for each command line that enters
   * the command.
   *
   * Return the command itself to stay synchronous, or a promise of it to
   * load it from another file with `import()`. Parsing only waits when a
   * command on the command line returns a promise.
   *
   * A command with a `loadSpec` sets only what its parent reads before then:
   * its `name`, `description`, `hidden` and `isPersistent`. Those are used
   * as they are here. The loaded command has the same name, and the spec
   * checks report one that sets any of the others differently.
   */
  loadSpec?: () => Subcommand | Promise<Subcommand>;

  /**
   * This property never exists. It prevents accidental structural assignment
   * between options and subcommands.
   *
   * @ignore
   */
  [kind]?: "Subcommand";
}

/**
 * A named input. Without `args`, the option is a flag.
 *
 * Use `has` to read flags and `get` or `all` to read values. Without
 * `isRepeatable`, each use replaces the option's previous values.
 */
export interface Option {
  /** Name or aliases, including any desired prefix such as `-`, `--`, or `/`. */
  name: SingleOrArray<string>;

  /** Description shown in help. */
  description?: string;

  /**
   * A second key to read this option by in an action, for an option that
   * shares a name with a different option on a command above or below it.
   * Reading by that name gives whichever of the two was used last, and
   * reading by the ref always gives this option. The spec checks require a
   * ref on both options, and allow one nowhere else.
   */
  ref?: string;

  /** Arguments this option accepts. */
  args?: SingleOrArray<Arg>;

  /** Allow this option to be used by descendant subcommands. */
  isPersistent?: true;

  /** Omit this option from help and completion. Its names still work. */
  hidden?: true;

  /**
   * Require a value attached with an enabled option argument separator.
   * `true` accepts any enabled separator. A string requires that separator.
   * The separator must be enabled in `parserDirectives.optionArgSeparators`.
   */
  requiresSeparator?: true | string;

  /**
   * Allow this option to be supplied multiple times. `true` allows any number
   * of uses, and a number is the most uses allowed. An option with arguments
   * collects the values from every use, in order. Without arguments, each use
   * adds an empty string, so `count()` returns the number of uses.
   */
  isRepeatable?: true | number;

  /**
   * Require an explicit use of this option. Defaults do not satisfy it.
   * A selected option action bypasses this check.
   */
  isRequired?: true;

  /**
   * Names of options that cannot be supplied with this option, in either
   * order. Names include prefixes and resolve in the scope of this option's
   * use. Defaults do not count. Option actions bypass this check.
   */
  exclusiveOn?: NonEmptyArray<string>;

  /**
   * Names of options that must also be supplied. Names include prefixes and
   * resolve in the scope of this option's use. Defaults do not count.
   * Option actions bypass this check.
   */
  dependsOn?: NonEmptyArray<string>;

  /**
   * Action performed when this option is provided.
   *
   * The last supplied option with an action replaces the command action.
   * It bypasses positional counts, required options and option relationships.
   * Unknown options and malformed option values still fail parsing.
   */
  action?: Action;

  /**
   * This property never exists. It prevents accidental structural assignment
   * between options and subcommands.
   *
   * @ignore
   */
  [kind]?: "Option";
}

/**
 * A built-in completion template.
 *
 * Resolves to the shell's native path completion. Completions only — no effect
 * on parsing.
 */
export type Template = "filepaths" | "folders" | ["folders", "filepaths"] | ["filepaths", "folders"];

/**
 * A single completion suggestion.
 *
 * This is a deliberately small subset of the Fig `Suggestion` shape — just the
 * fields the completion engine uses. Presentational fields (icon, priority,
 * displayName, insertValue, type) are intentionally omitted.
 */
export interface Suggestion {
  /** Value(s) inserted when the suggestion is accepted. */
  name: SingleOrArray<string>;

  /** Additional information shown next to the suggestion. */
  description?: string;
}

/**
 * Generates dynamic completion suggestions.
 *
 * `custom` runs inside the CLI when the shell asks it for completions. It only
 * affects completion and has no effect on parsing.
 */
export interface Generator {
  /**
   * Produce suggestions synchronously or asynchronously. Tokens exclude the
   * program name and end with the partial value. For an attached value such
   * as `--target=prod`, the last token is `"prod"`. Completion does not run
   * the selected command action.
   */
  custom?(tokens: string[]): (Suggestion | string)[] | Promise<(Suggestion | string)[]>;
}

/**
 * A positional argument or an argument of an option. Values are strings.
 *
 * Use an object for one argument and an array for two or more. Required
 * arguments precede optional arguments. A variadic argument must be last.
 */
export interface Arg {
  /** Name shown in generated help. */
  name?: string;

  /**
   * Description shown in help. A command's positional arguments are listed
   * with their descriptions and defaults. An option argument's description
   * isn't shown.
   */
  description?: string;

  /**
   * Accept one or more values, or zero or more with `isOptional`. Only the
   * final argument can be variadic. Values stay in the containing array.
   */
  isVariadic?: true;

  /** Allow this argument to be omitted. Arguments are required by default. */
  isOptional?: true;

  /**
   * The value used when this argument is left out.
   *
   * - A positional argument's default is added to `args`, so the argument
   *   must be optional.
   * - An optional option argument's default is added when the option is used
   *   without it, so a bare `--inspect` can mean `--inspect=9229`.
   * - A required option argument's default is what `get` and `all` return
   *   when the option isn't used. `has` and `count` still say it wasn't.
   *
   * Defaults fill consecutive omitted arguments, stopping at the first
   * argument without a default. A variadic default contributes one value.
   * Defaults do not count as supplied options for requirements or relationships.
   * Help shows an option's defaults after its description.
   */
  default?: string;

  /** Completions: complete file or folder paths for this argument. */
  template?: Template;

  /** Static completion suggestions. These do not restrict accepted input. */
  suggestions?: readonly (string | Suggestion)[];

  /** Completion generators for this argument. These do not validate input. */
  generators?: SingleOrArray<Generator>;
}
