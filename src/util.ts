import type { SingleOrArray } from "./types.js";
import { host } from "./host.js";

/**
 * `Array.isArray`, typed to narrow read-only arrays. `asArray` and the
 * functions of the args module run on every parse, so they call
 * `Array.isArray` and cast instead, which saves a cold start compiling this
 * function.
 */
export function isArray<T>(o: T | readonly T[]): o is readonly T[] {
  return Array.isArray(o);
}

/** Convert the value, if any, to an array with 0 or more elements */
export function makeArray<T>(thing: T | readonly T[] | undefined): T[] {
  if (thing === undefined) {
    return [];
  }
  if (isArray(thing)) {
    return thing.slice();
  }
  return [thing];
}

/**
 * `items` as a {@link SingleOrArray}: the item if there's one, the array if
 * there are more, or undefined if there are none.
 */
export function singleOrArray<T>(items: readonly T[]): SingleOrArray<T> | undefined {
  return items.length > 1 ? (items as readonly [T, T, ...T[]]) : items[0];
}

/**
 * Like {@link makeArray}, but without copying when the input is already an
 * array. Only safe when the caller treats the result as read-only — use it on
 * the hot path to avoid slicing read-only spec metadata.
 */
export function asArray<T>(thing: T | readonly T[] | undefined): readonly T[] {
  if (thing === undefined) {
    return [];
  }
  if (Array.isArray(thing)) {
    return thing;
  }
  return [thing as T];
}

export function assert(expr: unknown, msg = ""): asserts expr {
  if (!expr) {
    throw new Error(msg);
  }
}

/**
 * Print the values to stdout, separated by spaces, then a line break. Like
 * {@link printError}, it writes to the file descriptor without the stream
 * that the first `console.log` of a process builds, which costs 1 to 3 ms.
 */
export function print(...values: unknown[]): void {
  host.write(1, `${values.map(String).join(" ")}\n`);
}

/** Print `Error:` and the given values to stderr, separated by spaces. */
export function printError(...strings: unknown[]): void {
  host.write(2, `${["Error:", ...strings].map(String).join(" ")}\n`);
}

/**
 * The message for a value that an action, a `loadSpec` or an argument's parser threw. A
 * value that isn't an Error is shown as JSON where it can be, since `String`
 * turns an object into "[object Object]".
 */
export function describeThrown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      // A cycle or a BigInt, which JSON can't show.
    }
  }
  return String(value);
}
