import type { NonEmptyArray } from "./types.js";

export function isArray<T>(o: T | readonly T[]): o is readonly T[] {
  return Array.isArray(o);
}

/** Convert the value, if any, to an array with 0 or more elements */
export function makeArray<T>(thing: T | readonly T[] | undefined): T[] {
  if (thing === undefined) return [];
  if (isArray(thing)) {
    return thing.slice();
  }
  return [thing];
}

/**
 * Like {@link makeArray}, but without copying when the input is already an
 * array. Only safe when the caller treats the result as read-only — use it on
 * the hot path to avoid slicing read-only spec metadata.
 */
export function asArray<T>(thing: T | readonly T[] | undefined): readonly T[] {
  if (thing === undefined) return [];
  if (isArray(thing)) return thing;
  return [thing];
}

/** Convert the value to an array with at least one element */
export function makeArray1<T>(thing: T | NonEmptyArray<T>): [T, ...T[]] {
  if (isArray(thing)) {
    // We know that this array has at least one element in it
    return thing.slice() as [T, ...T[]];
  }
  return [thing];
}

/** Set many keys in a Map to the same value */
export function setEach<K, V>(map: Map<K, V>, keys: K | readonly K[], value: V): void {
  if (isArray(keys)) {
    for (const key of keys) {
      map.set(key, value);
    }
  } else {
    map.set(keys, value);
  }
}

export function assert(expr: unknown, msg = ""): asserts expr {
  if (!expr) {
    throw new Error(msg);
  }
}

// Output {{{

interface WriteSyncFs {
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
}

interface NodeProcess {
  getBuiltinModule?(id: "node:fs"): WriteSyncFs;
  stdout?: { write(data: Uint8Array): unknown };
  stderr?: { write(data: Uint8Array): unknown };
}

const nodeProcess = (globalThis as { process?: NodeProcess }).process;

/**
 * Write text to stdout (1) or stderr (2) with a synchronous `write` on the file
 * descriptor.
 *
 * The first `console.log` in a Node process builds the stdout stream, which
 * costs 1-3 ms. That's more than parsing takes, so all of this library's output
 * goes through here instead. Without `node:fs` it falls back to `console`.
 */
function writeFd(fd: 1 | 2, text: string): void {
  const fs = nodeProcess?.getBuiltinModule?.("node:fs");
  if (!fs) {
    (fd === 1 ? console.log : console.error)(text.endsWith("\n") ? text.slice(0, -1) : text);
    return;
  }
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  try {
    while (offset < bytes.length) {
      offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    // A non-blocking pipe that's full: let Node's stream queue the rest.
    if (code === "EAGAIN") {
      (fd === 1 ? nodeProcess?.stdout : nodeProcess?.stderr)?.write(bytes.subarray(offset));
    }
    // Anything else, like EPIPE from `cli --help | head -1`, is dropped, the
    // same as `console` does.
  }
}

/**
 * Where this library's output goes. Tests replace `write` to capture output.
 *
 * @internal
 */
export const output: { write: (fd: 1 | 2, text: string) => void } = { write: writeFd };

/** Print a message to stdout, trimming trailing whitespace. */
export function print(text: string): void {
  output.write(1, `${text.trimEnd()}\n`);
}

/** Print `Error:` and the given values to stderr, separated by spaces. */
export function printError(...strings: unknown[]): void {
  output.write(2, `${["Error:", ...strings].map(String).join(" ")}\n`);
}

// }}}

/**
 * Returns the minimum number of arguments that satisfies the args.
 *
 * Accepts the raw spec value (a single arg, an array, or `undefined`) so the
 * hot path doesn't have to copy it into an array first.
 */
export function getMinArgs(
  args: { isOptional?: boolean } | readonly { isOptional?: boolean }[] | undefined,
): number {
  if (args === undefined) return 0;
  if (!isArray(args)) return args.isOptional ? 0 : 1;
  let count = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i].isOptional) {
      break;
    }
    count++;
  }
  return count;
}

/** Returns the maximum number of arguments that satisfies the args. */
export function getMaxArgs(
  args: { isVariadic?: boolean } | readonly { isVariadic?: boolean }[] | undefined,
): number {
  if (args === undefined) return 0;
  if (!isArray(args)) return args.isVariadic ? Infinity : 1;
  // Loop over the array backwards because variadic arguments are
  // more likely to be at the end of the array. They don't _need_
  // to be, but it's more idiomatic.
  for (let i = 0; i < args.length; i++) {
    if (args[args.length - 1 - i].isVariadic) {
      return Infinity;
    }
  }
  // None of the arguments are variadic, max is the number of args
  return args.length;
}
