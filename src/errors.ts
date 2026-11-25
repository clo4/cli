import type { CommandPath, Option } from "./types.js";
import type { Choice } from "./closest.js";

const repr = JSON.stringify as (str: string) => string;

export interface ErrorContext {
  path: CommandPath;
  /**
   * The index of the token the problem is in, or -1 for the program's name. A
   * problem with a command, like an argument it's missing, is in the token
   * that names the command. Undefined for a problem in no token, like an
   * invalid default.
   */
  token?: number;
  /** Where the value starts in the word, for a value attached to its option. */
  start?: number;
}

/** What the user typed, and the names they could have meant. */
export interface DidYouMean {
  input: string;
  choices: readonly Choice[];
}

/**
 * A command line the parser can't accept. `run` prints the message with the
 * help for the command at `context.path`, and suggests the closest of
 * `didYouMean.choices` if there is one.
 *
 * It isn't an `Error`, because `run` prints only its message. An `Error`
 * records a stack trace that nothing would show, which made a usage error
 * slower to build.
 */
export class ParseError {
  constructor(
    readonly context: ErrorContext,
    readonly message: string,
    readonly didYouMean?: DidYouMean,
    /** Each problem, for an error that reports several. */
    readonly problems?: readonly ParseError[],
  ) {}
}

/*
 * The messages of the problems the parser finds, each in words for the user.
 */

const count = (n: number, what: string) => `${n} ${what}${n === 1 ? "" : "s"}`;

/** A word written like an option that names none here. */
export function unknownOption(option: string, choices: readonly Choice[], context: ErrorContext): ParseError {
  return new ParseError(context, `${repr(option)} looks like a flag, but is unknown in this context`, {
    input: option,
    choices,
  });
}

export const takesNoArguments = (option: string) => `Option ${option} doesn't take arguments`;

export const tooManyArguments = (value: string) => `Too many arguments, ${repr(value)} was unexpected`;

/** How many arguments something takes, at least `min` and at most `max`. */
function howMany(min: number, max: number): string {
  if (min === max) {
    return count(min, "argument");
  }
  if (max === Infinity) {
    return `at least ${count(min, "argument")}`;
  }
  return `between ${min} and ${max} arguments`;
}

export const tooFewOptionArguments = (option: string, min: number, max: number) =>
  `Option ${option} needs ${howMany(min, max)}`;

export const tooFewArguments = (min: number, max: number) => `Expected ${howMany(min, max)}`;

export const missingOption = (name: string) => `Option ${name} is required, but wasn't found`;

/** An option as a message names it, by all its names, like `-v/--verbose`. */
export function optionNames(option: Option): string {
  return typeof option.name === "string" ? option.name : option.name.join("/");
}

export const requiresOption = (option: Option, name: string) =>
  `${optionNames(option)} requires ${name}, add it to fix this error`;

export const excludesOption = (option: Option, name: string) =>
  `${optionNames(option)} can't be used together with ${name}`;

export const tooManyRepetitions = "Too many repetitions";

export const separatorAfterArguments = "Unexpected argument '--', did you mean to use an option instead?";

export const missingSeparator = (separator: string, name: string) =>
  `Missing separator, use '${separator}' between ${name} and its value`;

export const incorrectSeparator = (required: string, separator: string) =>
  `Incorrect separator, use '${required}' instead of '${separator}'`;

export const emptyCommand = "Expected a command, but the value was empty";

export const ambiguousCommand = (word: string, names: readonly string[]) =>
  `Ambiguous command '${word}', could be: ${names.join(", ")}`;

export const unknownCommand = (word: string) => `Unknown command '${word}'`;

/**
 * A value that its argument's parser rejected. `target` is what the value is
 * for, as the user would write it: an option name like `--port`, or `<port>`
 * for a positional argument. `isDefault` is for a default from the spec,
 * which the user didn't type. `choices` are the values that parser lists, and
 * `run` suggests the closest one. `reason` is what that parser said.
 */
export function invalidValue(
  value: string,
  target: string,
  reason: string,
  isDefault: boolean,
  context: ErrorContext,
  choices?: readonly string[],
): ParseError {
  const what = isDefault
    ? `The default ${repr(value)} for ${target} is invalid`
    : `Invalid value ${repr(value)} for ${target}`;
  return new ParseError(
    context,
    reason === "" ? what : `${what}: ${reason}`,
    choices && !isDefault ? { input: value, choices } : undefined,
  );
}

/**
 * The error for `problems`: the problem itself if there's one, or all of them
 * together. The parser stops at a word it can't read, and reports that alone.
 * Once it has read the whole line, what's missing and what an argument's
 * parser rejected don't depend on each other, so it reports all of it for the
 * user to fix in one go. `run` prints each message on a line of its own, then
 * the help once.
 */
export function problemsError(problems: readonly ParseError[]): ParseError {
  if (problems.length === 1) {
    return problems[0];
  }
  let didYouMean: DidYouMean | undefined;
  const messages: string[] = [];
  for (const problem of problems) {
    messages.push(problem.message);
    didYouMean ??= problem.didYouMean;
  }
  return new ParseError(problems[0].context, messages.join("\nError: "), didYouMean, problems);
}
