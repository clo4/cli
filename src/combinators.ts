/**
 * Functions that read a value with structure, like `10s`, `1920x1080` or
 * `KEY=a,KEY=b`, and give the action its pieces.
 *
 * ```ts
 * import { choice, int, seq } from "@clo4/cli";
 *
 * // Reads `10s` as `{ amount: 10, unit: "s" }`.
 * const duration = seq(int, choice("s", "m", "h", "d")).map(([amount, unit]) => ({ amount, unit }));
 * ```
 *
 * Each function takes parts. A part is a string, which must appear exactly
 * as written, or the result of another of these functions. Parts are read
 * left to right with nothing between them, and each reads as much of the
 * value as it can.
 *
 * @module
 */

import { bare, fail, literal, number, Parser, patternOf, tooBig } from "./schemas.js";
import type { Part, State, ValueOf } from "./schemas.js";

/** Read one part. A string part gives itself as the value. */
function read(part: Part, input: string, start: number, state: State): number {
  if (typeof part !== "string") {
    return part.read(input, start, state);
  }
  if (!input.startsWith(part, start)) {
    return fail(state, start, { kind: "text", text: part });
  }
  state.out = part;
  return start + part.length;
}

/** A part as help shows it. */
const show = (part: Part): string => (typeof part === "string" ? literal(part) : patternOf(part));

/**
 * A part as help shows it before the `...` of a repeat. A part that
 * repeats is in brackets, like `((a|b)...),...`, so that each `...` can be
 * matched with what it repeats. With `whole`, so is a part made of several,
 * like `(<int>(s|m))...`.
 */
function showRepeated(part: Part, whole: boolean): string {
  const shown = show(part);
  if (typeof part === "string") {
    return whole && part.length > 1 && shown === part ? `(${shown})` : shown;
  }
  const inner = part.label === undefined ? bare(part) : part;
  if (inner.label !== undefined) {
    return shown;
  }
  const repeats =
    inner instanceof ManyParser ||
    inner instanceof SepByParser ||
    (whole && inner instanceof Seq && inner.parts.length > 1);
  return repeats ? `(${shown})` : shown;
}

/** What the parts `P` of a `seq` give: the value of each parser, in order. A string gives none. */
export type Values<P extends readonly Part[]> = P extends readonly [
  infer First,
  ...infer Rest extends readonly Part[],
]
  ? First extends Parser<infer T>
    ? [T, ...Values<Rest>]
    : Values<Rest>
  : [];

/** The label of the part `P`, or never for a string and for a parser without a label. */
type LabelOf<P> = P extends Parser<unknown, infer L> ? (string extends L ? never : L & string) : never;

/** What `asObject` gives for the parts `P` of a `seq`: the value of each labelled parser, under its label. */
export type Fields<P extends readonly Part[]> = {
  [K in P[number] as LabelOf<K>]: K extends Parser<infer T> ? T : never;
};

/** The first label that two of the parts `P` share, or never. */
type Duplicate<P extends readonly Part[], Seen = never> = P extends readonly [
  infer First,
  ...infer Rest extends readonly Part[],
]
  ? [LabelOf<First>] extends [never]
    ? Duplicate<Rest, Seen>
    : LabelOf<First> extends Seen
      ? LabelOf<First>
      : Duplicate<Rest, Seen | LabelOf<First>>
  : never;

/**
 * The parser that {@link seq} returns. It's a {@link Parser} that can also
 * give its values as an object.
 *
 * @typeParam P - The parts the `seq` reads.
 */
export class Seq<const P extends readonly Part[]> extends Parser<Values<P>> {
  constructor(readonly parts: P) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const parts = this.parts;
    const values = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === "string") {
        if (!input.startsWith(part, start)) {
          return fail(state, start, { kind: "text", text: part });
        }
        start += part.length;
      } else {
        if ((start = part.read(input, start, state)) < 0) {
          return -1;
        }
        values.push(state.out);
      }
    }
    state.out = values;
    return start;
  }

  pattern(): string {
    return this.parts.map(show).join("");
  }

  /**
   * Give the values as an object in place of the tuple. Each part labelled
   * with `as` gives its value under its label, and a part without a label
   * gives none, so `seq(int.as("width"), "x", int.as("height")).asObject()`
   * reads `1920x1080` as `{ width: 1920, height: 1080 }`.
   *
   * @throws If two parts have the same label.
   */
  asObject(
    ...duplicate: [Duplicate<P>] extends [never] ? [] : [error: `Two parts are labelled "${Duplicate<P>}"`]
  ): Parser<Fields<P>>;
  asObject(): Parser<Record<string, unknown>> {
    const keys: (string | undefined)[] = [];
    for (const part of this.parts) {
      if (typeof part !== "string") {
        if (part.label !== undefined && keys.includes(part.label)) {
          throw new Error(`Two parts of the seq are labelled ${JSON.stringify(part.label)}`);
        }
        keys.push(part.label);
      }
    }
    return this.map((values: unknown[]) => {
      const fields: Record<string, unknown> = {};
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (key === "__proto__") {
          // Assigning to this key would set the object's prototype.
          Object.defineProperty(fields, key, {
            value: values[i],
            enumerable: true,
            writable: true,
            configurable: true,
          });
        } else if (key !== undefined) {
          fields[key] = values[i];
        }
      }
      return fields;
    });
  }
}

/** What {@link optional} returns. */
class OptionalParser<T> extends Parser<T | undefined> {
  constructor(readonly part: Part) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const end = read(this.part, input, start, state);
    if (end >= 0) {
      return end;
    }
    state.out = undefined;
    return start;
  }

  pattern(): string {
    return `[${show(this.part)}]`;
  }

  override get optional(): boolean {
    return true;
  }
}

/** What {@link many} returns. */
class ManyParser<T> extends Parser<T[]> {
  constructor(
    readonly part: Part,
    readonly min: number,
  ) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const values = [];
    let at = start;
    for (;;) {
      const end = read(this.part, input, at, state);
      // A part that read nothing would be read forever.
      if (end <= at) {
        break;
      }
      values.push(state.out);
      at = end;
    }
    if (values.length < this.min) {
      // The part that wasn't there has usually said what it expected.
      return state.far >= at ? -1 : fail(state, at, { kind: "parser", parser: this });
    }
    state.out = values;
    return at;
  }

  pattern(): string {
    return `${showRepeated(this.part, true)}...`;
  }
}

/** What {@link sepBy} returns. */
class SepByParser<T> extends Parser<T[]> {
  constructor(
    readonly part: Part,
    readonly separator: string,
  ) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const separator = this.separator;
    const values = [];
    for (;;) {
      if ((start = read(this.part, input, start, state)) < 0) {
        return -1;
      }
      values.push(state.out);
      if (!input.startsWith(separator, start)) {
        // Another one could have come next, which a message or completion can say.
        fail(state, start, { kind: "text", text: separator });
        break;
      }
      start += separator.length;
    }
    state.out = values;
    return start;
  }

  pattern(): string {
    return `${showRepeated(this.part, false)}${literal(this.separator)}...`;
  }
}

/** What {@link text} returns. */
class TextParser extends Parser<string> {
  constructor(readonly stops: readonly string[]) {
    super();
  }

  read(input: string, start: number, state: State): number {
    const stops = this.stops;
    let end = input.length;
    for (let i = 0; i < stops.length; i++) {
      const at = input.indexOf(stops[i], start);
      if (at >= 0 && at < end) {
        end = at;
      }
    }
    if (end === start) {
      return fail(state, start, { kind: "words", words: "some text" });
    }
    state.out = input.slice(start, end);
    return end;
  }

  pattern(): string {
    return "<text>";
  }
}

/** What {@link uint} is. */
class UintParser extends Parser<number> {
  read(input: string, start: number, state: State): number {
    let at = start;
    let value = 0;
    for (let digit; (digit = input.charCodeAt(at) - 48) >= 0 && digit <= 9; at++) {
      value = value * 10 + digit;
    }
    if (at === start) {
      return fail(state, start, { kind: "parser", parser: this });
    }
    // A sum of more than 15 digits might not be the number that was typed.
    if (at - start > 15 && !Number.isSafeInteger((value = Number(input.slice(start, at))))) {
      return tooBig(state, input, start, at, value, true);
    }
    state.out = value;
    return at;
  }

  pattern(): string {
    return "<int>";
  }

  schema(): Record<string, unknown> {
    return { type: "integer", minimum: 0 };
  }
}

/** A whole number, like `12` or `-3`. The same as `number({ int: true })`. */
export const int: Parser<number> = /* @__PURE__ */ number({ int: true });

/**
 * A whole number written in digits alone, like `12`. It never reads a minus
 * sign, so `-0` is rejected, and `seq(uint, "x", uint)` rejects `1920x-1080`.
 * Use it for the numbers in a format.
 */
export const uint: Parser<number> = /* @__PURE__ */ new UintParser();

/**
 * Reads each part in order. Gives the values as a tuple, and a string gives
 * no value, so `seq(int, "x", int)` reads `1920x1080` as `[1920, 1080]`.
 * Call `asObject` on the result to give the labelled values as an object.
 *
 * @typeParam P - Inferred from the parts. Do not supply it explicitly.
 */
export const seq = <const P extends readonly Part[]>(...parts: P): Seq<P> => new Seq(parts);

/**
 * Reads the part if it's there. Gives its value, or undefined, so
 * `seq(optional("v"), int)` reads both `v2` and `2`.
 */
export const optional = <const P extends Part>(part: P): Parser<ValueOf<P> | undefined> =>
  new OptionalParser(part);

/**
 * Reads the part zero or more times in a row. Gives the values as an
 * array, so `many(choice("r", "w", "x"))` reads `rw` as `["r", "w"]`.
 *
 * @param min - The fewest times the part must appear. Default: 0.
 */
export const many = <const P extends Part>(part: P, min = 0): Parser<ValueOf<P>[]> =>
  new ManyParser(part, min);

/**
 * Reads the part one or more times, with `separator` between each pair.
 * Gives the values as an array, so `sepBy(int, ",")` reads `1,2,3` as
 * `[1, 2, 3]`.
 */
export const sepBy = <const P extends Part>(part: P, separator: string): Parser<ValueOf<P>[]> =>
  new SepByParser(part, separator);

/**
 * Reads one or more characters, up to the first of `stops` or the end of
 * the value. `seq(text("="), "=", text())` reads `KEY=a=b` as `["KEY", "a=b"]`.
 */
export const text = (...stops: string[]): Parser<string> => new TextParser(stops);
