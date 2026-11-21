import type { CommandPath } from "./types.js";
import type { Choice } from "./suggest.js";

const repr = JSON.stringify as (str: string) => string;

export interface ErrorContext {
  path: CommandPath;
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

/** A token written like an option that names none here. */
export function unknownOption(option: string, choices: readonly Choice[], context: ErrorContext): ParseError {
  return new ParseError(context, `${repr(option)} looks like a flag, but is unknown in this context`, {
    input: option,
    choices,
  });
}

export const takesNoArguments = (option: string) => `Option ${option} doesn't take arguments`;

export const tooManyArguments = (value: string) => `Too many arguments, ${repr(value)} was unexpected`;

export function tooFewOptionArguments(option: string, min: number, max: number): string {
  return min === max
    ? `Option ${option} needs ${count(min, "argument")}`
    : !Number.isFinite(max)
      ? `Option ${option} needs at least ${count(min, "argument")}`
      : `Option ${option} needs between ${min} and ${max} arguments`;
}

export function tooFewArguments(min: number, max: number): string {
  return min === max
    ? `Expected ${count(min, "argument")}`
    : !Number.isFinite(max)
      ? `Expected at least ${count(min, "argument")}`
      : `Expected between ${min} and ${max} arguments`;
}

export const missingOption = (name: string) => `Option ${name} is required, but wasn't found`;

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
 * together. The parser stops at a token it can't read, and reports that alone.
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
