/**
 * `number` and `choice`, and the {@link Parser} class they return.
 *
 * A {@link Parser} holds an {@link Atom} and what the atom reads. Help shows
 * it as a pattern, and completion offers the text that can come next.
 * `./combinators.js` has the functions that combine them, like `seq`.
 *
 * @module
 */

import type { StandardResult } from "./types.js";

/**
 * One reading of a value. An atom leaves the value it read in `out`. `want`
 * is everything that was expected at `far`, the furthest place an atom
 * failed. Each reading gets a state of its own, so a parser made by one copy
 * of this library can read with a part made by another.
 */
export interface State {
  out: unknown;
  far: number;
  want: unknown[] | undefined;
}

/** One kind of parser. A parser's `atom` reads the value and describes the parser. */
export interface Atom {
  /**
   * Read `input` from `start` for the parser `self`. Returns where it
   * stopped, or -1, and leaves its value in `state.out`.
   */
  run(self: Parser<any>, input: string, start: number, state: State): number;
  /** The parser as help shows it, like `<int>` or `(s|m|h|d)`. */
  pattern(self: Parser<any>): string;
  /** The parser in words for a message, like `an integer from 1 to 5`. */
  words?(self: Parser<any>): string | undefined;
  /** What the parser takes as JSON Schema, if JSON Schema has words for it. */
  schema?(self: Parser<any>): Record<string, unknown> | undefined;
  /** Each value the parser accepts, for a parser that help shows as a list of them. */
  list?(self: Parser<any>): string[] | undefined;
  /** The strings the parser lists among its values, as the user types them. */
  choices?(self: Parser<any>): string[] | undefined;
  /** Whether the value can leave the part out. Help shows its label in brackets, like `[<to>]`. */
  optional?: boolean;
}

/** A piece of a parser: a string that must appear exactly as written, or another parser. */
export type Part = string | Parser<unknown>;

/** What a part gives: a string gives itself, and a parser gives its value. */
export type ValueOf<P> = P extends string ? P : P extends Parser<infer T> ? T : never;

/**
 * Note that `what` was expected at `at`, and return -1 for the atom to
 * return. `what` is a string that has to be there as written, the values of
 * a choice, a parser, or an object with the words as its `label`. An object
 * with a `problem` is a complaint about text that was read. See {@link tooBig}.
 */
export function fail(state: State, at: number, what: unknown): -1 {
  if (at > state.far) {
    state.far = at;
    state.want = [what];
  } else if (at === state.far) {
    state.want!.push(what);
  }
  return -1;
}

/**
 * A value an argument can be, as help and messages show it. A value can have
 * any characters in it, so one that's empty or has a space, a quote, a
 * comma, a bracket or a `|` is in quotes, and a list of them separated by
 * ` | ` can only be read one way.
 */
export function describeChoice(value: unknown): string {
  const text = String(value);
  return text === "" || /[\s|,()"']/.test(text) ? JSON.stringify(text) : text;
}

/** Something that was expected, in words for a message. */
function wordsOf(what: unknown): string {
  if (typeof what === "string") {
    return JSON.stringify(what);
  }
  if (Array.isArray(what)) {
    // A parser among a choice's values has said what it expected itself.
    return what
      .filter((value) => typeof value === "string")
      .map(describeChoice)
      .join(" | ");
  }
  if (isParser(what)) {
    return what.atom.words?.(what) ?? patternOf(what);
  }
  return (what as { label: string }).label;
}

/**
 * What's wrong with `input`, for a parser that stopped at `end` without
 * reading all of it. It's a function of its own so that a value the parser
 * accepts never compiles it.
 */
function explain(self: Parser<any>, state: State, input: unknown, end: number): StandardResult<never> {
  if (typeof input !== "string") {
    return { issues: [{ message: "expected a string" }] };
  }
  let message: string;
  let at = state.far;
  if (end > at) {
    // The parser read a value and nothing asked for more, so the rest is extra.
    const words = self.atom.words?.(self);
    at = words === undefined ? end : 0;
    message = words === undefined ? `unexpected ${JSON.stringify(input.slice(end))}` : `expected ${words}`;
  } else {
    const wants: string[] = [];
    for (const what of state.want ?? []) {
      // A number that was read and can't be given says so in place of what was expected.
      const { problem, text } = what as { problem?: string; text?: string };
      if (problem !== undefined) {
        return { issues: [{ message: text === input ? problem : `${text} is ${problem}` }] };
      }
      const words = wordsOf(what);
      if (words !== "" && !wants.includes(words)) {
        wants.push(words);
      }
    }
    message = `expected ${wants.join(" or ")}`;
  }
  return {
    issues: [{ message: at > 0 ? `${message} after ${JSON.stringify(input.slice(0, at))}` : message }],
  };
}

/**
 * Reads the string the user typed and gives the action a value, or says
 * what it expected instead. {@link number}, {@link choice} and the functions
 * that combine parsers, like `seq`, each return one.
 *
 * It's also a [Standard Schema](https://standardschema.dev), so it works
 * anywhere one is accepted.
 *
 * @typeParam T - What the parser gives.
 * @typeParam L - The label `as` gave the parser. Inferred, so do not supply it explicitly.
 */
export class Parser<T, L extends string | undefined = string | undefined> {
  /** How the parser reads a value. */
  declare readonly atom: Atom;
  /** What the atom reads, such as a choice's values, a `seq`'s parts or the parser that `map` wraps. */
  declare readonly of: any;
  /** What else the atom needs, like the function of a `map`. */
  declare readonly fn: any;
  /** The name `as` gave the parser. */
  declare readonly label: L;
  declare readonly version: 1;
  declare readonly vendor: string;
  declare readonly types?: { readonly input: string; readonly output: T } | undefined;

  constructor(atom: Atom, of?: unknown, fn?: unknown, label?: L) {
    this.atom = atom;
    this.of = of;
    this.fn = fn;
    this.label = label as L;
  }

  /**
   * Pass the value through `fn`.
   * `seq(int, "x", int).map(([width, height]) => ({ width, height }))` gives
   * an object in place of the tuple. The new parser keeps the label.
   */
  map<U>(fn: (value: T) => U): Parser<U, L> {
    return new Parser(mapAtom, this, fn, this.label);
  }

  /**
   * Name the parser. Help shows the name in place of its pattern, so
   * `seq(int.as("width"), "x", int.as("height"))` is shown as
   * `<width>x<height>`. A `seq` also uses the name as the key for the value
   * in `asObject`.
   */
  as<const Label extends string>(label: Label): Parser<T, Label> {
    return new Parser(this.atom, this.of, this.fn, label);
  }

  /** Returns the parser itself, so reading this allocates nothing. */
  get "~standard"(): this {
    return this;
  }

  /** Gives the value, or what was expected as `issues`. */
  validate(input: unknown): StandardResult<T> {
    const state: State = { out: undefined, far: -1, want: undefined };
    const end = typeof input === "string" ? this.atom.run(this, input, 0, state) : -1;
    return end === (input as string).length ? { value: state.out as T } : explain(this, state, input, end);
  }

  /** What the parser takes as JSON Schema, for a number or a choice of strings. */
  get jsonSchema(): { input(): Record<string, unknown> } | undefined {
    const schema = this.atom.schema?.(this);
    return schema && { input: () => schema };
  }
}
(Parser.prototype as { version: 1 }).version = 1;
(Parser.prototype as { vendor: string }).vendor = "@clo4/cli";

/** Whether `value` is a {@link Parser}, from this copy of the library or another. */
export function isParser(value: unknown): value is Parser<unknown> {
  return typeof (value as Parser<unknown> | undefined)?.atom?.run === "function";
}

/**
 * A parser as help shows it: its label in angle brackets, or else its
 * atom's pattern. The label of a part that can be left out is in brackets
 * too, like `[<to>]`.
 */
export function patternOf(parser: Parser<unknown>): string {
  if (parser.label === undefined) {
    return parser.atom.pattern(parser);
  }
  let inner = parser;
  while (inner.atom === mapAtom) {
    inner = inner.of;
  }
  return inner.atom.optional ? `[<${parser.label}>]` : `<${parser.label}>`;
}

/**
 * A string that has to be there as written, as a pattern shows it. One
 * that could be read as part of the pattern is in quotes, like `"["` or
 * `"..."`, and so is one that's empty or has a tab or a line break.
 */
export function literal(text: string): string {
  return text === "" || text.includes("...") || /[\t\n\r|()[\]<>"']/.test(text) ? JSON.stringify(text) : text;
}

export const mapAtom: Atom = {
  run(self, input, start, state) {
    const inner: Parser<unknown> = self.of;
    const end = inner.atom.run(inner, input, start, state);
    if (end >= 0) {
      state.out = self.fn(state.out);
    }
    return end;
  },
  pattern: (self) => patternOf(self.of),
  words: (self) => self.of.atom.words?.(self.of),
  schema: (self) => self.of.atom.schema?.(self.of),
  list: (self) => listOf(self.of),
  choices: (self) => self.of.atom.choices?.(self.of),
};

/** The least and greatest numbers a schema accepts, and whether each is itself left out. */
export interface Bounds {
  min?: number | undefined;
  max?: number | undefined;
  minExclusive?: boolean;
  maxExclusive?: boolean;
}

/**
 * A number's type and range in words, like `int from 1 to 65535`. Help
 * shows it, and {@link number} says it in its message. A range with a bound
 * that's left out names each bound, like `number, more than 0 and less than 1`.
 */
export function describeRange(type: string, { min, max, minExclusive, maxExclusive }: Bounds): string {
  if (min !== undefined && max !== undefined && !minExclusive && !maxExclusive) {
    return `${type} from ${min} to ${max}`;
  }
  const least = min === undefined ? "" : `${minExclusive ? "more than" : "at least"} ${min}`;
  const greatest = max === undefined ? "" : `${maxExclusive ? "less than" : "at most"} ${max}`;
  if (least === "" && greatest === "") {
    return type;
  }
  return `${type}, ${least}${least !== "" && greatest !== "" ? " and " : ""}${greatest}`;
}

/** What {@link number} takes. */
interface NumberOptions {
  min?: number;
  max?: number;
  int?: boolean;
}

/**
 * Read a number that {@link numberAtom} can't add up digit by digit: one
 * with a decimal point, or with more than 15 digits. `stop` is where its
 * whole digits end.
 */
function slowNumber(self: Parser<number>, input: string, start: number, stop: number, state: State): number {
  const options: NumberOptions | undefined = self.of;
  let digits = stop - start - (input.charCodeAt(start) === 45 ? 1 : 0);
  // A dot is the number's only if a digit follows it, so `1..5` can be two numbers.
  const afterDot = input.charCodeAt(stop + 1);
  if (input.charCodeAt(stop) === 46 && !options?.int && afterDot >= 48 && afterDot <= 57) {
    for (stop++; input.charCodeAt(stop) >= 48 && input.charCodeAt(stop) <= 57; stop++) {
      digits++;
    }
  }
  const value = Number(input.slice(start, stop));
  if (digits === 0 || (options !== undefined && (value < options.min! || value > options.max!))) {
    return fail(state, start, self);
  }
  if (!Number.isFinite(value) || (options?.int && !Number.isSafeInteger(value))) {
    return tooBig(state, input, start, stop, value, options?.int);
  }
  state.out = value;
  return stop;
}

/**
 * Note that the digits from `start` to `stop` are a number too far from zero
 * to give: a whole number that a JavaScript number can't hold exactly, or
 * any number that reads as infinity. Returns -1 for the atom to return. The
 * message says so in place of what was expected, like
 * `too large, the limit is 9007199254740991`.
 */
export function tooBig(
  state: State,
  input: string,
  start: number,
  stop: number,
  value: number,
  int: boolean | undefined,
): -1 {
  const size = value > 0 ? "large" : "small";
  return fail(state, start, {
    problem: int
      ? `too ${size}, the limit is ${value > 0 ? "" : "-"}${Number.MAX_SAFE_INTEGER}`
      : `too ${size} to be a number`,
    text: input.slice(start, stop),
  });
}

const numberAtom: Atom = {
  run(self, input, start, state) {
    const options: NumberOptions | undefined = self.of;
    let at = start;
    const negative = input.charCodeAt(at) === 45;
    if (negative) {
      at++;
    }
    const first = at;
    let value = 0;
    for (let digit; (digit = input.charCodeAt(at) - 48) >= 0 && digit <= 9; at++) {
      value = value * 10 + digit;
    }
    // A sum of more than 15 digits might not be the number that was typed.
    if (at - first > 15 || input.charCodeAt(at) === 46) {
      return slowNumber(self, input, start, at, state);
    }
    if (at === first) {
      return fail(state, start, self);
    }
    if (negative) {
      value = -value;
    }
    // A bound that's left out is undefined, and no number is less or more than that.
    if (options !== undefined && (value < options.min! || value > options.max!)) {
      return fail(state, start, self);
    }
    state.out = value;
    return at;
  },
  pattern: (self) => (self.of?.int ? "<int>" : "<number>"),
  words(self) {
    const options: NumberOptions = self.of ?? {};
    return `${options.int ? "an integer" : "a number"}${describeRange("", options)}`;
  },
  schema(self) {
    const options: NumberOptions = self.of ?? {};
    const schema: Record<string, unknown> = { type: options.int ? "integer" : "number" };
    if (options.min !== undefined) {
      schema.minimum = options.min;
    }
    if (options.max !== undefined) {
      schema.maximum = options.max;
    }
    return schema;
  },
};

const choiceAtom: Atom = {
  run(self, input, start, state) {
    const values: readonly Part[] = self.of;
    let end = -1;
    let chosen;
    for (let i = 0; i < values.length; i++) {
      const value = values[i];
      if (typeof value === "string") {
        if (start + value.length > end && input.startsWith(value, start)) {
          end = start + value.length;
          chosen = value;
        }
      } else {
        const stop = value.atom.run(value, input, start, state);
        if (stop > end) {
          end = stop;
          chosen = state.out;
        }
      }
    }
    if (end < 0) {
      return fail(state, start, values);
    }
    if (end === start) {
      // Only a value that reads nothing fit, so completion can still offer the rest.
      fail(state, start, values);
    }
    state.out = chosen;
    return end;
  },
  pattern: (self) =>
    `(${self.of.map((value: Part) => (typeof value === "string" ? literal(value) : patternOf(value))).join("|")})`,
  words: (self) => choiceAtom.list!(self)!.join(" | "),
  schema: (self) =>
    self.of.every((value: Part) => typeof value === "string")
      ? { type: "string", enum: [...self.of] }
      : undefined,
  list: (self) =>
    self.of.map((value: Part) => (typeof value === "string" ? describeChoice(value) : patternOf(value))),
  choices: (self) =>
    self.of.flatMap((value: Part) =>
      typeof value === "string" ? [value] : (value.atom.choices?.(value) ?? []),
    ),
};

/** Each value `parser` accepts as help lists them, unless it has a label or isn't shown as a list. */
export function listOf(parser: Parser<unknown>): string[] | undefined {
  return parser.label === undefined ? parser.atom.list?.(parser) : undefined;
}

/**
 * A parser that turns the value into a number.
 *
 * The value is written in decimal digits, with an optional minus sign and
 * decimal point. It isn't read the way `Number` reads it, so an empty
 * string, `0x1F`, `1e3` and a value with a space in it are rejected. So is
 * a value with too many digits to be a finite number. A decimal point needs
 * a digit after it, so `.5` is a number and `3.` isn't.
 *
 * Help shows the type and range after the argument's description, like
 * `(int from 1 to 65535)`.
 *
 * @param options - `min` and `max` are the least and greatest numbers
 * accepted, each included. `int` accepts whole numbers only.
 * @returns A parser that gives a number.
 */
export const number = (options?: { min?: number; max?: number; int?: boolean }): Parser<number> =>
  new Parser(numberAtom, options);

/**
 * A parser that accepts one of `values` and rejects anything else. A value
 * is a string, or a parser. `choice("debug", "release")` gives
 * `"debug" | "release"`, and `choice("auto", number())` gives
 * `"auto" | number`.
 *
 * Where more than one value fits, the one that reads the most wins, so
 * `choice("m", "ms")` reads `ms` whichever comes first.
 *
 * Help shows the values after the argument's description, and completion
 * offers the strings unless the argument has suggestions of its own. A
 * rejected value that's close to one of the strings gets a "Did you mean"
 * line.
 *
 * @typeParam T - Inferred from the values. Do not supply it explicitly.
 * @param values - The values accepted. A string is as the user types it.
 * @returns A parser that gives the value that was typed.
 */
export const choice = <const T extends readonly [Part, ...Part[]]>(
  ...values: T
): Parser<ValueOf<T[number]>> => new Parser(choiceAtom, values);

/** Add to `found` what `typed` could become that starts with `partial`. */
function addCompletions(found: string[], parser: Parser<unknown>, typed: string, partial: string): void {
  const state: State = { out: undefined, far: -1, want: undefined };
  try {
    parser.atom.run(parser, typed, 0, state);
  } catch {
    // A `map` function that can't take a value that's only partly typed.
  }
  if (state.far < 0) {
    return;
  }
  const read = typed.slice(0, state.far);
  const rest = typed.slice(state.far);
  for (const what of state.want!) {
    for (const text of Array.isArray(what) ? what : [what]) {
      if (typeof text !== "string" || !text.startsWith(rest)) {
        continue;
      }
      const value = read + text;
      if (value.length > typed.length && value.startsWith(partial) && !found.includes(value)) {
        found.push(value);
      }
    }
  }
}

/**
 * What a partly typed value could become, for completion to offer. It reads
 * `partial` with `parser`, and where the reading stopped it adds each string
 * that was expected there. For `seq(int, choice("s", "m"))` and `10`, that's
 * `10s` and `10m`. Nothing is offered where a number or other text comes
 * next.
 *
 * It reads each shorter start of `partial` the same way, because a string
 * can be expected before the place the reading stopped. `choice("s", "sec")`
 * reads the `s` of `se` and stops, and only the empty start expects `sec`.
 *
 * A value that's already whole is offered as it is when it ends with one of
 * those strings, so the shell can finish the word.
 */
export function completionsOf(parser: Parser<unknown>, partial: string): string[] {
  const found: string[] = [];
  for (let end = 0; end <= partial.length; end++) {
    addCompletions(found, parser, partial.slice(0, end), partial);
  }
  // `read,` ends with a string that was expected, and isn't a whole value.
  const whole = found.indexOf(partial);
  if (whole >= 0 && !accepts(parser, partial)) {
    found.splice(whole, 1);
  }
  return found;
}

/** Whether `parser` reads all of `value`. */
export function accepts(parser: Parser<unknown>, value: string): boolean {
  try {
    return parser.atom.run(parser, value, 0, { out: undefined, far: -1, want: undefined }) === value.length;
  } catch {
    return false;
  }
}
