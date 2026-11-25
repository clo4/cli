/**
 * `number` and `choice`, and the {@link Parser} class every built-in parser
 * extends.
 *
 * A parser reads a value and describes itself: help shows it as a pattern,
 * and completion offers the text that can come next. `./combinators.js` has
 * the functions that combine them, like `seq`.
 *
 * @module
 */

import type { StandardResult } from "./types.js";

/**
 * What a reading wanted at a place in the value: a string as written, one of
 * a choice's values, a value a parser describes, something in words, or a
 * complaint about text that was read, like a number too large to give.
 */
export type Want =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "choice"; readonly values: readonly Part[] }
  | { readonly kind: "parser"; readonly parser: Parser<unknown> }
  | { readonly kind: "words"; readonly words: string }
  | { readonly kind: "problem"; readonly problem: string; readonly text: string };

/**
 * One reading of a value. A parser leaves the value it read in `out`. `want`
 * is everything that was wanted at `far`, the furthest place a parser
 * failed. Each reading gets a state of its own, so a parser made by one copy
 * of this library can read with a part made by another.
 */
export interface State {
  out: unknown;
  far: number;
  want: Want[] | undefined;
}

/** A piece of a parser: a string that must appear exactly as written, or another parser. */
export type Part = string | Parser<unknown>;

/** What a part gives: a string gives itself, and a parser gives its value. */
export type ValueOf<P> = P extends string ? P : P extends Parser<infer T> ? T : never;

/** Note that `want` was wanted at `at`, and return -1 for the parser to return. */
export function fail(state: State, at: number, want: Want): -1 {
  if (at > state.far) {
    state.far = at;
    state.want = [want];
  } else if (at === state.far) {
    state.want!.push(want);
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

/**
 * A parser in words for a message, like `an integer from 1 to 5` or
 * `debug | release`: each value it lists, or else the type and range of the
 * number it takes. Undefined for any other parser.
 */
function wordsOf(parser: Parser<unknown>): string | undefined {
  const list = listOf(parser);
  if (list) {
    return list.join(" | ");
  }
  const schema = schemaOf(parser);
  if (schema?.type !== "integer" && schema?.type !== "number") {
    return undefined;
  }
  const bounds = { min: schema.minimum as number | undefined, max: schema.maximum as number | undefined };
  return `${schema.type === "integer" ? "an integer" : "a number"}${describeRange("", bounds)}`;
}

/** What was wanted, in words for a message. A complaint isn't something wanted, and says "". */
function wanted(want: Want): string {
  switch (want.kind) {
    case "text":
      return JSON.stringify(want.text);
    case "choice":
      // A parser among a choice's values has said what it wanted itself.
      return want.values
        .filter((value) => typeof value === "string")
        .map(describeChoice)
        .join(" | ");
    case "parser":
      return wordsOf(want.parser) ?? patternOf(want.parser);
    case "words":
      return want.words;
    case "problem":
      return "";
  }
}

/**
 * What's wrong with `input`, for a parser that stopped at `end` without
 * reading all of it. It's a function of its own so that a value the parser
 * accepts never compiles it.
 */
function explain(self: Parser<unknown>, state: State, input: unknown, end: number): StandardResult<never> {
  if (typeof input !== "string") {
    return { issues: [{ message: "expected a string" }] };
  }
  let message: string;
  let at = state.far;
  if (end > at) {
    // The parser read a value and nothing asked for more, so the rest is extra.
    const words = wordsOf(self);
    at = words === undefined ? end : 0;
    message = words === undefined ? `unexpected ${JSON.stringify(input.slice(end))}` : `expected ${words}`;
  } else {
    const wants: string[] = [];
    for (const want of state.want ?? []) {
      // A number that was read and can't be given says so in place of what was wanted.
      if (want.kind === "problem") {
        return {
          issues: [{ message: want.text === input ? want.problem : `${want.text} is ${want.problem}` }],
        };
      }
      const words = wanted(want);
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
export abstract class Parser<T, L extends string | undefined = string | undefined> {
  /** The name `as` gave the parser. */
  readonly label: L;
  declare readonly types?: { readonly input: string; readonly output: T } | undefined;

  constructor(label?: L) {
    this.label = label as L;
  }

  /** Read `input` from `start`. Returns where it stopped, or -1, and leaves its value in `state.out`. */
  abstract read(input: string, start: number, state: State): number;

  /** The parser as help shows it without its label, like `<int>` or `(s|m|h|d)`. */
  abstract pattern(): string;

  /**
   * What the parser takes as JSON Schema, if JSON Schema has words for it.
   * A message says what a number or a choice of strings expects from this.
   */
  schema?(): Record<string, unknown> | undefined;

  /** Each value the parser accepts, for a parser that help shows as a list of them. */
  list?(): string[] | undefined;

  /** The strings the parser lists among its values, as the user types them. */
  choices?(): string[] | undefined;

  /** The parser without the `map`s around it, which describes it. See {@link bare}. */
  bare(): Parser<unknown> {
    return this;
  }

  /** Whether a value can leave the parser's part out. Help shows its label in brackets, like `[<to>]`. */
  get optional(): boolean {
    return false;
  }

  /**
   * Pass the value through `fn`.
   * `seq(int, "x", int).map(([width, height]) => ({ width, height }))` gives
   * an object in place of the tuple. The new parser keeps the label.
   */
  map<U>(fn: (value: T) => U): Parser<U, L> {
    // The new parser is this one with the value passed through `fn`, so it
    // describes itself as this one does. It isn't a subclass, because a
    // bundler keeps a class that a method of the class it extends refers to.
    const mapped: Parser<U, L> = Object.create(this);
    mapped.read = (input, start, state) => {
      const end = this.read(input, start, state);
      if (end >= 0) {
        state.out = fn(state.out as T);
      }
      return end;
    };
    mapped.bare = () => this.bare();
    return mapped;
  }

  /**
   * Name the parser. Help shows the name in place of its pattern, so
   * `seq(int.as("width"), "x", int.as("height"))` is shown as
   * `<width>x<height>`. A `seq` also uses the name as the key for the value
   * in `asObject`.
   */
  as<const Label extends string>(label: Label): Parser<T, Label> {
    return Object.assign(Object.create(Object.getPrototypeOf(this)), this, { label });
  }

  /** Returns the parser itself, so reading this allocates nothing. */
  get "~standard"(): this {
    return this;
  }

  /** Gives the value, or what was expected as `issues`. */
  validate(input: unknown): StandardResult<T> {
    const state: State = { out: undefined, far: -1, want: undefined };
    const end = typeof input === "string" ? this.read(input, 0, state) : -1;
    return end === (input as string).length ? { value: state.out as T } : explain(this, state, input, end);
  }

  /** What the parser takes as JSON Schema, for a number or a choice of strings. */
  get jsonSchema(): { input(): Record<string, unknown> } | undefined {
    const schema = schemaOf(this);
    return schema && { input: () => schema };
  }

  // Getters, so that every parser shares them without an assignment to the
  // prototype, which a bundler would have to keep even for a CLI with no parser.

  /** The version of the Standard Schema specification the parser follows. */
  get version(): 1 {
    return 1;
  }

  /** The library the parser comes from. */
  get vendor(): string {
    return "@clo4/cli";
  }
}

/** Whether `value` is a {@link Parser}, from this copy of the library or another. */
export function isParser(value: unknown): value is Parser<unknown> {
  const parser = value as Parser<unknown> | undefined;
  return typeof parser?.read === "function" && typeof parser.pattern === "function";
}

/**
 * A parser as help shows it: its label in angle brackets, or else its
 * pattern. The label of a part that can be left out is in brackets too,
 * like `[<to>]`.
 */
export function patternOf(parser: Parser<unknown>): string {
  if (parser.label === undefined) {
    return parser.pattern();
  }
  return bare(parser).optional ? `[<${parser.label}>]` : `<${parser.label}>`;
}

/**
 * `parser` without the `map`s around it. A `map` reads what the parser it
 * wraps reads, so that parser describes it: its schema, its list and its
 * choices are the wrapped parser's.
 */
export function bare(parser: Parser<unknown>): Parser<unknown> {
  return parser.bare();
}

/** What `parser` takes as JSON Schema, if JSON Schema has words for it. */
export function schemaOf(parser: Parser<unknown>): Record<string, unknown> | undefined {
  return bare(parser).schema?.();
}

/** The strings `parser` lists among its values, as the user types them. */
export function choicesOf(parser: Parser<unknown>): string[] | undefined {
  return bare(parser).choices?.();
}

/** Each value `parser` accepts as help lists them, unless it has a label or isn't shown as a list. */
export function listOf(parser: Parser<unknown>): string[] | undefined {
  return parser.label === undefined ? bare(parser).list?.() : undefined;
}

/**
 * A string that has to be there as written, as a pattern shows it. One
 * that could be read as part of the pattern is in quotes, like `"["` or
 * `"..."`, and so is one that's empty or has a tab or a line break.
 */
export function literal(text: string): string {
  return text === "" || text.includes("...") || /[\t\n\r|()[\]<>"']/.test(text) ? JSON.stringify(text) : text;
}

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
 * Note that the digits from `start` to `stop` are a number too far from zero
 * to give: a whole number that a JavaScript number can't hold exactly, or
 * any number that reads as infinity. Returns -1 for the parser to return.
 * The message says so in place of what was expected, like
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
    kind: "problem",
    problem: int
      ? `too ${size}, the limit is ${value > 0 ? "" : "-"}${Number.MAX_SAFE_INTEGER}`
      : `too ${size} to be a number`,
    text: input.slice(start, stop),
  });
}

/** What {@link number} returns. */
class NumberParser extends Parser<number> {
  constructor(readonly options: NumberOptions | undefined) {
    super();
  }

  read(input: string, start: number, state: State): number {
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
      return this.readSlowly(input, start, at, state);
    }
    if (at === first) {
      return fail(state, start, { kind: "parser", parser: this });
    }
    if (negative) {
      value = -value;
    }
    if (this.outside(value)) {
      return fail(state, start, { kind: "parser", parser: this });
    }
    state.out = value;
    return at;
  }

  /**
   * Read a number that {@link read} can't add up digit by digit: one with a
   * decimal point, or with more than 15 digits. `stop` is where its whole
   * digits end.
   */
  private readSlowly(input: string, start: number, stop: number, state: State): number {
    const int = this.options?.int;
    let digits = stop - start - (input.charCodeAt(start) === 45 ? 1 : 0);
    // A dot is the number's only if a digit follows it, so `1..5` can be two numbers.
    const afterDot = input.charCodeAt(stop + 1);
    if (input.charCodeAt(stop) === 46 && !int && afterDot >= 48 && afterDot <= 57) {
      for (stop++; input.charCodeAt(stop) >= 48 && input.charCodeAt(stop) <= 57; stop++) {
        digits++;
      }
    }
    const value = Number(input.slice(start, stop));
    if (digits === 0 || this.outside(value)) {
      return fail(state, start, { kind: "parser", parser: this });
    }
    if (!Number.isFinite(value) || (int && !Number.isSafeInteger(value))) {
      return tooBig(state, input, start, stop, value, int);
    }
    state.out = value;
    return stop;
  }

  /**
   * Whether `value` is outside the bounds. A bound that's left out is
   * undefined, and no number is less or more than that.
   */
  private outside(value: number): boolean {
    const options = this.options;
    return options !== undefined && (value < options.min! || value > options.max!);
  }

  pattern(): string {
    return this.options?.int ? "<int>" : "<number>";
  }

  schema(): Record<string, unknown> {
    const options: NumberOptions = this.options ?? {};
    const schema: Record<string, unknown> = { type: options.int ? "integer" : "number" };
    if (options.min !== undefined) {
      schema.minimum = options.min;
    }
    if (options.max !== undefined) {
      schema.maximum = options.max;
    }
    return schema;
  }
}

/** What {@link choice} returns. */
class ChoiceParser<T> extends Parser<T> {
  constructor(readonly values: readonly Part[]) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const values = this.values;
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
        const stop = value.read(input, start, state);
        if (stop > end) {
          end = stop;
          chosen = state.out;
        }
      }
    }
    if (end < 0) {
      return fail(state, start, { kind: "choice", values });
    }
    if (end === start) {
      // Only a value that reads nothing fit, so completion can still offer the rest.
      fail(state, start, { kind: "choice", values });
    }
    state.out = chosen;
    return end;
  }

  pattern(): string {
    return `(${this.values.map((value) => (typeof value === "string" ? literal(value) : patternOf(value))).join("|")})`;
  }

  schema(): Record<string, unknown> | undefined {
    return this.values.every((value) => typeof value === "string")
      ? { type: "string", enum: [...this.values] }
      : undefined;
  }

  list(): string[] {
    return this.values.map((value) => (typeof value === "string" ? describeChoice(value) : patternOf(value)));
  }

  choices(): string[] {
    return this.values.flatMap((value) => (typeof value === "string" ? [value] : (choicesOf(value) ?? [])));
  }
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
  new NumberParser(options);

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
): Parser<ValueOf<T[number]>> => new ChoiceParser(values);

/** Add to `found` what `typed` could become that starts with `partial`. */
function addCompletions(found: string[], parser: Parser<unknown>, typed: string, partial: string): void {
  const state: State = { out: undefined, far: -1, want: undefined };
  try {
    parser.read(typed, 0, state);
  } catch {
    // A `map` function that can't take a value that's only partly typed.
  }
  if (state.far < 0) {
    return;
  }
  const read = typed.slice(0, state.far);
  const rest = typed.slice(state.far);
  const offer = (text: string) => {
    const value = read + text;
    if (
      text.startsWith(rest) &&
      value.length > typed.length &&
      value.startsWith(partial) &&
      !found.includes(value)
    ) {
      found.push(value);
    }
  };
  for (const want of state.want!) {
    if (want.kind === "text") {
      offer(want.text);
    } else if (want.kind === "choice") {
      for (const value of want.values) {
        if (typeof value === "string") {
          offer(value);
        }
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
    return parser.read(value, 0, { out: undefined, far: -1, want: undefined }) === value.length;
  } catch {
    return false;
  }
}
