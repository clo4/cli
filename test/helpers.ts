import { expect } from "vitest";

import { run as runAndSetExitCode } from "../src/run.js";
import { testSpec } from "../src/testing.js";
import type { Spec, Subcommand } from "../src/types.js";
import { output } from "../src/util.js";

/**
 * Runs the spec checks with these function-style step names on `spec`, through
 * `testSpec`, and skips the rest. Resolves with the first error one of them
 * throws, or undefined when they all pass. Throws when `testSpec` has no step
 * with one of the names, so a typo can't make a check look like it passed.
 */
export async function specCheckError(names: readonly string[], spec: Subcommand): Promise<unknown> {
  const steps: string[] = [];
  const errors: unknown[] = [];
  await testSpec(spec, { namingStyle: "function" })({
    async step(name, fn) {
      steps.push(name);
      if (!names.includes(name)) {
        return;
      }
      try {
        await fn();
      } catch (error) {
        errors.push(error);
      }
    },
  });
  const unknown = names.filter((name) => !steps.includes(name));
  if (unknown.length > 0) {
    throw new Error(`testSpec has no spec check named ${unknown.join(", ")}`);
  }
  return errors[0];
}

/**
 * Runs the spec check with this function-style step name on `spec`, through
 * `testSpec`, and skips the rest. Rejects with the error the check throws.
 */
export async function runSpecCheck(name: string, spec: Subcommand): Promise<void> {
  const error = await specCheckError([name], spec);
  if (error !== undefined) {
    throw error;
  }
}

export function map<V>(record: Record<string, V>): Map<string, V> {
  return new Map(Object.entries(record));
}

export async function captureConsole(
  fn: () => unknown | Promise<unknown>,
): Promise<{ code: unknown; stdout: string; stderr: string }> {
  const originalLog = console.log;
  const originalError = console.error;
  let stdout = "";
  let stderr = "";
  console.log = (...args) => {
    stdout += `${args.join(" ")}\n`;
  };
  console.error = (...args) => {
    stderr += `${args.join(" ")}\n`;
  };
  // The library writes to the file descriptors directly; actions use console.
  const originalWrite = output.write;
  output.write = (fd, text) => {
    if (fd === 1) {
      stdout += text;
    } else {
      stderr += text;
    }
  };
  try {
    const code = await fn();
    return { code, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
    output.write = originalWrite;
  }
}

export function expectIncludes(value: string, included: string): void {
  expect(value, `Expected to find ${JSON.stringify(included)}`).toContain(included);
}

export function expectNotIncludes(value: string, notIncluded: string): void {
  expect(value, `Expected not to find ${JSON.stringify(notIncluded)}`).not.toContain(notIncluded);
}

/**
 * `run` on `argv`, without setting the exit code of the process the tests
 * run in.
 */
export function run(spec: Spec, argv: readonly string[]): Promise<number> {
  return runAndSetExitCode(spec, { argv, setExitCode: false });
}
