import { expect } from "vitest";

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
  try {
    const code = await fn();
    return { code, stdout, stderr };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export function expectIncludes(value: string, included: string): void {
  expect(value, `Expected to find ${JSON.stringify(included)}`).toContain(included);
}

export function expectNotIncludes(value: string, notIncluded: string): void {
  expect(value, `Expected not to find ${JSON.stringify(notIncluded)}`).not.toContain(notIncluded);
}
