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

/**
 * Print the values to stdout, separated by spaces, then a line break. Like
 * {@link printError}, it writes to the file descriptor without the stream
 * that the first `console.log` of a process builds, which costs 1 to 3 ms.
 */
export function print(...values: unknown[]): void {
  output.write(1, `${values.map(String).join(" ")}\n`);
}

/** Print `Error:` and the given values to stderr, separated by spaces. */
export function printError(...strings: unknown[]): void {
  output.write(2, `${["Error:", ...strings].map(String).join(" ")}\n`);
}

// }}}

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
