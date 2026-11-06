import type { CommandPath } from "./types.js";

const repr = JSON.stringify as (str: string) => string;

export interface ErrorContext {
  path: CommandPath;
}

export class ParseError extends Error {
  readonly context: ErrorContext;
  constructor(context: ErrorContext, ...args: ConstructorParameters<ErrorConstructor>) {
    super(...args);
    this.context = context;
    this.name = this.constructor.name;
  }
}

export class UnknownOption extends ParseError {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly option: string;
  readonly validOptions: string[];
  constructor(
    found: { option: string; validOptions: string[]; index: number; start: number; end: number },
    context: ErrorContext,
  ) {
    const msg = `${repr(found.option)} looks like a flag, but is unknown in this context`;
    super(context, msg);
    this.option = found.option;
    this.validOptions = found.validOptions;
    this.index = found.index;
    this.start = found.start;
    this.end = found.end;
  }
}

export class InvalidOptionArg extends ParseError {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  readonly arg: string;
  readonly option: string;
  constructor(
    found: { option: string; arg: string; index: number; start: number; end: number },
    context: ErrorContext,
  ) {
    const msg = `Option ${found.option} doesn't take arguments`;
    super(context, msg);
    this.index = found.index;
    this.start = found.start;
    this.end = found.end;
    this.option = found.option;
    this.arg = found.arg;
  }
}

export class TooManyArguments extends ParseError {
  readonly index: number;
  readonly value: string;
  constructor(found: { value: string; index: number }, context: ErrorContext) {
    const msg = `Too many arguments, ${repr(found.value)} was unexpected`;
    super(context, msg);
    this.index = found.index;
    this.value = found.value;
  }
}

export class TooFewOptionArguments extends ParseError {
  constructor(min: number, max: number, context: ErrorContext) {
    const msg =
      min === max
        ? `Option needs ${min} argument${min === 1 ? "" : "s"}`
        : !Number.isFinite(max)
          ? `Option needs at least ${min} argument${min === 1 ? "" : "s"}`
          : `Option needs between ${min} and ${max} arguments`;
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
