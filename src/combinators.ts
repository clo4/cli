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

import { fail, number, Parser, patternOf, tooBig } from "./schemas.js";
import type { Atom, Part, State, ValueOf } from "./schemas.js";

/** Read one part. A string part gives itself as the value. */
function read(part: Part, input: string, start: number, state: State): number {
  if (typeof part !== "string") {
    return part.atom.run(part, input, start, state);
  }
  if (!input.startsWith(part, start)) {
    return fail(state, start, part);
  }
  state.out = part;
  return start + part.length;
}

/** A part as help shows it. */
const show = (part: Part): string => (typeof part === "string" ? part : patternOf(part));

const seqAtom: Atom = {
  run(self, input, start, state) {
    const parts: readonly Part[] = self.of;
    const values = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (typeof part === "string") {
        if (!input.startsWith(part, start)) {
          return fail(state, start, part);
        }
        start += part.length;
      } else {
        if ((start = part.atom.run(part, input, start, state)) < 0) {
          return -1;
        }
        values.push(state.out);
      }
    }
    state.out = values;
    return start;
  },
  pattern: (self) => self.of.map(show).join(""),
};

const optionalAtom: Atom = {
  run(self, input, start, state) {
    const end = read(self.of, input, start, state);
    if (end >= 0) {
      return end;
    }
    state.out = undefined;
    return start;
  },
  pattern: (self) => `[${show(self.of)}]`,
};

const manyAtom: Atom = {
  run(self, input, start, state) {
    const values = [];
    let at = start;
    for (;;) {
      const end = read(self.of, input, at, state);
      // A part that read nothing would be read forever.
      if (end <= at) {
        break;
      }
      values.push(state.out);
      at = end;
    }
    if (values.length < self.fn) {
      // The part that wasn't there has usually said what it expected.
      return state.far >= at ? -1 : fail(state, at, self);
    }
    state.out = values;
    return at;
  },
  pattern: (self) => `${show(self.of)}...`,
};

const sepByAtom: Atom = {
  run(self, input, start, state) {
    const separator: string = self.fn;
    const values = [];
    for (;;) {
      if ((start = read(self.of, input, start, state)) < 0) {
        return -1;
      }
      values.push(state.out);
      if (!input.startsWith(separator, start)) {
        // Another one could have come next, which a message or completion can say.
        fail(state, start, separator);
        break;
      }
      start += separator.length;
    }
    state.out = values;
    return start;
  },
  pattern: (self) => `${show(self.of)}${self.fn}...`,
};

const someText = { label: "some text" };

const textAtom: Atom = {
  run(self, input, start, state) {
    const stops: readonly string[] = self.of;
    let end = input.length;
    for (let i = 0; i < stops.length; i++) {
      const at = input.indexOf(stops[i], start);
      if (at >= 0 && at < end) {
        end = at;
      }
    }
    if (end === start) {
      return fail(state, start, someText);
    }
    state.out = input.slice(start, end);
    return end;
  },
  pattern: () => "<text>",
};

/** What the parts `P` of a `seq` give: the value of each parser, in order. A string gives none. */
export type Values<P extends readonly Part[]> = P extends readonly [
  infer First,
  ...infer Rest extends readonly Part[],
]
  ? First extends Parser<infer T>
    ? [T, ...Values<Rest>]
    : Values<Rest>
  : [];

/** A whole number, like `12` or `-3`. The same as `number({ int: true })`. */
export const int: Parser<number> = number({ int: true });

const uintAtom: Atom = {
  run(self, input, start, state) {
    let at = start;
    let value = 0;
    for (let digit; (digit = input.charCodeAt(at) - 48) >= 0 && digit <= 9; at++) {
      value = value * 10 + digit;
    }
    if (at === start) {
      return fail(state, start, self);
    }
    // A sum of more than 15 digits might not be the number that was typed.
    if (at - start > 15 && !Number.isSafeInteger((value = Number(input.slice(start, at))))) {
      return tooBig(state, input, start, at, value, true);
    }
    state.out = value;
    return at;
  },
  pattern: () => "<int>",
  words: () => "an integer, at least 0",
  schema: () => ({ type: "integer", minimum: 0 }),
};

/**
 * A whole number written in digits alone, like `12`. It never reads a minus
 * sign, so `-0` is rejected, and `seq(uint, "x", uint)` rejects `1920x-1080`.
 * Use it for the numbers in a format.
 */
export const uint: Parser<number> = new Parser(uintAtom);

/**
 * Reads each part in order. Gives the values as a tuple, and a string gives
 * no value, so `seq(int, "x", int)` reads `1920x1080` as `[1920, 1080]`.
 *
 * @typeParam P - Inferred from the parts. Do not supply it explicitly.
 */
export const seq = <const P extends readonly Part[]>(...parts: P): Parser<Values<P>> =>
  new Parser(seqAtom, parts);

/**
 * Reads the part if it's there. Gives its value, or undefined, so
 * `seq(optional("v"), int)` reads both `v2` and `2`.
 */
export const optional = <const P extends Part>(part: P): Parser<ValueOf<P> | undefined> =>
  new Parser(optionalAtom, part);

/**
 * Reads the part zero or more times in a row. Gives the values as an
 * array, so `many(choice("r", "w", "x"))` reads `rw` as `["r", "w"]`.
 *
 * @param min - The fewest times the part must appear. Default: 0.
 */
export const many = <const P extends Part>(part: P, min = 0): Parser<ValueOf<P>[]> =>
  new Parser(manyAtom, part, min);

/**
 * Reads the part one or more times, with `separator` between each pair.
 * Gives the values as an array, so `sepBy(int, ",")` reads `1,2,3` as
 * `[1, 2, 3]`.
 */
export const sepBy = <const P extends Part>(part: P, separator: string): Parser<ValueOf<P>[]> =>
  new Parser(sepByAtom, part, separator);

/**
 * Reads one or more characters, up to the first of `stops` or the end of
 * the value. `seq(text("="), "=", text())` reads `KEY=a=b` as `["KEY", "a=b"]`.
 */
export const text = (...stops: string[]): Parser<string> => new Parser(textAtom, stops);
