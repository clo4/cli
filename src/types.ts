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

  /** Get every argument supplied to a option. */
  all(name: string): string[] | undefined;

  /** Get the first argument supplied to a option. */
  get(name: string): string | undefined;

  /** Check whether a option was supplied. */
  has(name: string): boolean;

  /** Count option values, useful for repeatable options. */
  count(name: string): number;
}

/** The data an action receives. */
export interface ActionInit {
  /** Options found for this invocation. */
  options: OptionArgs;

  /** Positional arguments found for the selected command. */
  args: string[];

  /** Commands used leading up to the selected action. */
  path: CommandPath;

  /** Index of the `--` argument separator, or -1 if it was not supplied. */
  argSeparatorIndex: number;

  /** Get help text for the currently executing command. */
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

/** A top-level command. */
export interface Spec extends Omit<Subcommand, "name"> {
  /** Name of the CLI. */
  name: string;
}

/** A subcommand that can be executed. */
export interface Subcommand {
  /** Name or aliases used for matching. */
  name: SingleOrArray<string>;

  /** Description shown in help. */
  description?: string;

  /** Positional arguments accepted by this command. */
  args?: SingleOrArray<Arg>;

  /** Options accepted by this command. */
  options?: NonEmptyArray<Option>;

  /** Subcommands of this command. */
  subcommands?: NonEmptyArray<Subcommand>;

  /** Direct parser behavior. */
  parserDirectives?: {
    /**
     * Treat option names literally, disabling POSIX short-option chaining and
     * unknown option errors for tokens that look option-like.
     */
    flagsArePosixNoncompliant?: boolean;

    /**
     * Once an argument has been found, all following tokens are arguments even
     * if they match options.
     */
    optionsMustPrecedeArguments?: boolean;

    /** Separators that can attach a option argument to a option token. */
    optionArgSeparators?: SingleOrArrayOrEmpty<string>;

    /**
     * Match subcommands by shortest unique prefix instead of exact name.
     * Hidden subcommands still only match their exact name.
     */
    subcommandsMatchUniquePrefix?: boolean;
  };

  /** Hide this command from help. */
  hidden?: true;

  /** Require a subcommand; without one, print usage. */
  requiresSubcommand?: true;

  /** Action to run when this command is selected. */
  action?: Action;

  /**
   * This property never exists. It prevents accidental structural assignment
   * between options and subcommands.
   *
   * @ignore
   */
  [kind]?: "Subcommand";
}

/** A option that modifies or overrides command execution. */
export interface Option {
  /** Name or aliases, including any desired prefix such as `-`, `--`, or `/`. */
  name: SingleOrArray<string>;

  /** Description shown in help. */
  description?: string;

  /** Arguments this option accepts. */
  args?: SingleOrArray<Arg>;

  /** Allow this option to be used by descendant subcommands. */
  isPersistent?: true;

  /** Hide this option from help. */
  hidden?: true;

  /** Only allow arguments to be supplied with a separator. */
  requiresSeparator?: true | string;

  /**
   * Allow this option to be supplied multiple times. `true` allows any number
   * of uses, and a number is the most uses allowed. An option with arguments
   * collects the values from every use, in order. Without arguments, each use
   * adds an empty string, so `count()` returns the number of uses.
   */
  isRepeatable?: true | number;

  /** Require this option to be supplied before the selected action runs. */
  isRequired?: true;

  /** Fail parsing if these options are provided. */
  exclusiveOn?: NonEmptyArray<string>;

  /** Fail parsing if these options are not provided. */
  dependsOn?: NonEmptyArray<string>;

  /**
   * Action performed when this option is provided.
   *
   * Option actions take precedence over command actions. The final parsed option
   * action is selected.
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
  /** Produce suggestions from the current command-line tokens. */
  custom?(tokens: string[]): (Suggestion | string)[] | Promise<(Suggestion | string)[]>;
}

/** Positional or option argument metadata. */
export interface Arg {
  /** Name shown in generated help. */
  name?: string;

  /** Description for documentation or future help output. */
  description?: string;

  /** Allow this argument to take unlimited values. */
  isVariadic?: true;

  /** Allow this argument to be omitted. */
  isOptional?: true;

  /** Completions: complete file or folder paths for this argument. */
  template?: Template;

  /** Completions: static suggestions offered while typing this argument. */
  suggestions?: readonly (string | Suggestion)[];

  /** Completions: dynamically generated suggestions for this argument. */
  generators?: SingleOrArray<Generator>;
}
