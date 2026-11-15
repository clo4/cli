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
  readonly name: string;
  readonly message: string;
  readonly context: ErrorContext;
  readonly didYouMean: DidYouMean | undefined;
  constructor(context: ErrorContext, message: string, didYouMean?: DidYouMean) {
    this.message = message;
    this.context = context;
    this.didYouMean = didYouMean;
    this.name = this.constructor.name;
  }
}

export class UnknownOption extends ParseError {
  readonly option: string;
  constructor(option: string, validOptions: readonly Choice[], context: ErrorContext) {
    const msg = `${repr(option)} looks like a flag, but is unknown in this context`;
    super(context, msg, { input: option, choices: validOptions });
    this.option = option;
  }
}

export class InvalidOptionArg extends ParseError {
  readonly option: string;
  constructor(option: string, context: ErrorContext) {
    super(context, `Option ${option} doesn't take arguments`);
    this.option = option;
  }
}

export class TooManyArguments extends ParseError {
  constructor(value: string, context: ErrorContext) {
    super(context, `Too many arguments, ${repr(value)} was unexpected`);
  }
}

export class TooFewOptionArguments extends ParseError {
  constructor(option: string, min: number, max: number, context: ErrorContext) {
    const msg =
      min === max
        ? `Option ${option} needs ${min} argument${min === 1 ? "" : "s"}`
        : !Number.isFinite(max)
          ? `Option ${option} needs at least ${min} argument${min === 1 ? "" : "s"}`
          : `Option ${option} needs between ${min} and ${max} arguments`;
    super(context, msg);
  }
}

export class TooFewArguments extends ParseError {
  constructor(min: number, max: number, context: ErrorContext) {
    const msg =
      min === max
        ? `Expected ${min} argument${min === 1 ? "" : "s"}`
        : !Number.isFinite(max)
          ? `Expected at least ${min} argument${min === 1 ? "" : "s"}`
          : `Expected between ${min} and ${max} arguments`;
    super(context, msg);
  }
}

export class MissingRequiredOption extends ParseError {
  constructor(name: string, context: ErrorContext) {
    const msg = `Option ${name} is required, but wasn't found`;
    super(context, msg);
  }
}

/** A value that its argument's `parse` rejected. `reason` is what the `parse` said about it. */
export class InvalidValue extends ParseError {
  readonly value: string;
  readonly reason: string;
  /**
   * `target` is what the value is for, as the user would write it: an option
   * name like `--port`, or `<port>` for a positional argument. `isDefault` is
   * for a default from the spec, which the user didn't type.
   */
  constructor(value: string, target: string, reason: string, isDefault: boolean, context: ErrorContext) {
    const what = isDefault
      ? `The default ${repr(value)} for ${target} is invalid`
      : `Invalid value ${repr(value)} for ${target}`;
    super(context, reason === "" ? what : `${what}: ${reason}`);
    this.value = value;
    this.reason = reason;
  }
}

/**
 * Every problem with a command line that has more than one. The parser stops
 * at a token it can't read, and reports that alone. Once it has read the
 * whole line, what's missing and what a `parse` rejected don't depend on each
 * other, so it reports all of it for the user to fix in one go.
 *
 * `run` prints each message on a line of its own, then the help once.
 */
export class SeveralProblems extends ParseError {
  readonly problems: readonly ParseError[];
  constructor(problems: readonly ParseError[]) {
    let didYouMean: DidYouMean | undefined;
    const messages: string[] = [];
    for (const problem of problems) {
      messages.push(problem.message);
      didYouMean ??= problem.didYouMean;
    }
    super(problems[0].context, messages.join("\nError: "), didYouMean);
    this.problems = problems;
  }
}

/** The error for `problems`: the problem itself if there's one, or all of them together. */
export function problemsError(problems: readonly ParseError[]): ParseError {
  return problems.length === 1 ? problems[0] : new SeveralProblems(problems);
}
