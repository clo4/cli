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
