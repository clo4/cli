/**
 * What the library asks of the environment it runs in: the command line,
 * where output goes, the exit code, and the file system for completing
 * paths. In Node, each comes from `process` and `node:fs`. Anywhere else,
 * like a browser, output goes to the console, and there's no command line,
 * exit code or file system.
 *
 * Nothing else in the library reads `process`.
 *
 * @module
 */

/** A directory entry, as completing a path reads it. */
export interface Entry {
  name: string;
  isDirectory(): boolean;
}

interface NodeFs {
  writeSync(fd: number, buffer: Uint8Array, offset: number, length: number): number;
  readdirSync(path: string, options: { withFileTypes: true }): Entry[];
}

interface NodeProcess {
  argv: readonly string[];
  exitCode?: number | string | undefined;
  platform: string;
  getBuiltinModule?(id: "node:fs"): NodeFs;
  stdout: { write(data: Uint8Array): unknown };
  stderr: { write(data: Uint8Array): unknown };
}

/** The Node process, or undefined anywhere else. */
const node = (globalThis as { process?: NodeProcess }).process;

/** `node:fs`, or undefined outside Node. It's looked up when it's needed, since most runs never are. */
const fs = (): NodeFs | undefined => node?.getBuiltinModule?.("node:fs");

/**
 * Write text to stdout (1) or stderr (2) with a synchronous `write` on the
 * file descriptor.
 *
 * The first `console.log` in a Node process builds the stdout stream, which
 * costs 1-3 ms. That's more than parsing takes, so all of this library's
 * output goes through here instead. Without `node:fs` it falls back to
 * `console`.
 */
function write(fd: 1 | 2, text: string): void {
  const nodeFs = fs();
  if (!nodeFs) {
    (fd === 1 ? console.log : console.error)(text.endsWith("\n") ? text.slice(0, -1) : text);
    return;
  }
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  try {
    while (offset < bytes.length) {
      offset += nodeFs.writeSync(fd, bytes, offset, bytes.length - offset);
    }
  } catch (error) {
    // A non-blocking pipe that's full: let Node's stream queue the rest.
    // Anything else, like EPIPE from `cli --help | head -1`, is dropped, the
    // same as `console` does.
    if ((error as { code?: string }).code === "EAGAIN") {
      (fd === 1 ? node!.stdout : node!.stderr).write(bytes.subarray(offset));
    }
  }
}

/**
 * The environment the library runs in. Tests replace `write` to capture
 * output.
 *
 * @internal
 */
export const host = {
  /** The command line after the program's name. */
  argv: (): readonly string[] => node?.argv.slice(2) ?? [],

  /** Set the code the process exits with. */
  setExitCode(code: number): void {
    if (node) {
      node.exitCode = code;
    }
  },

  write,

  /** Whether a path can be divided by `\` as well as `/`. */
  windows: (): boolean => node?.platform === "win32",

  /** The entries of the directory `path`, or null if it can't be read. */
  entries(path: string): Entry[] | null {
    try {
      return fs()?.readdirSync(path, { withFileTypes: true }) ?? null;
    } catch {
      return null;
    }
  },
};
