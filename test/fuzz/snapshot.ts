// Comparable snapshots of what `scan` returns or throws, so two runs (strict
// and lenient, or two versions of the parser) can be checked for differences.

import type { Action, Spec } from "../../src/types.js";

type Scan = (input: readonly string[], spec: Spec, strict: boolean) => unknown;

interface Result {
  path: readonly unknown[];
  actions: readonly Action[];
  optionActions: readonly Action[];
  args: readonly string[];
  argSeparatorIndex: number;
  options: Map<string, string[]>;
  seenOptions: readonly unknown[];
  localOptions: readonly unknown[];
  persistentOptions: readonly unknown[];
  openOption: { option: unknown; valueCount: number } | null;
  directives?: unknown;
}

export type Outcome = { ok: true; result: Result } | { ok: false; error: Error & Record<string, unknown> };

export function attempt(scan: Scan, input: readonly string[], spec: Spec, strict: boolean): Outcome {
  try {
    return { ok: true, result: scan(input, spec, strict) as Result };
  } catch (error) {
    return { ok: false, error: error as Error & Record<string, unknown> };
  }
}

/**
 * Describe how two outcomes differ, or return null if they match. Spec objects
 * (path entries, options, actions) must be the same objects. `sameAction`
 * decides whether two actions match, so two copies of the built-in usage
 * action can count as the same.
 */
export function difference(
  a: Outcome,
  b: Outcome,
  sameAction: (x: Action, y: Action) => boolean = Object.is,
): string | null {
  if (a.ok !== b.ok)
    return a.ok ? `only the second threw: ${describe(b)}` : `only the first threw: ${describe(a)}`;
  if (!a.ok || !b.ok) {
    const x = a.ok ? null : errorFields(a.error);
    const y = b.ok ? null : errorFields(b.error);
    if (JSON.stringify(x) !== JSON.stringify(y))
      return `errors differ: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
    const pathA = (a.ok ? null : (a.error.context as { path: unknown[] } | undefined))?.path ?? [];
    const pathB = (b.ok ? null : (b.error.context as { path: unknown[] } | undefined))?.path ?? [];
    return sameItems(pathA, pathB) ? null : "error paths differ";
  }
  const x = a.result;
  const y = b.result;
  for (const key of ["path", "seenOptions", "localOptions", "persistentOptions"] as const) {
    if (!sameItems(x[key], y[key])) return `${key} differ`;
  }
  for (const key of ["actions", "optionActions"] as const) {
    if (!sameItems(x[key], y[key], sameAction)) return `${key} differ`;
  }
  if (JSON.stringify(x.args) !== JSON.stringify(y.args)) {
    return `args differ: ${JSON.stringify(x.args)} vs ${JSON.stringify(y.args)}`;
  }
  if (x.argSeparatorIndex !== y.argSeparatorIndex) return "argSeparatorIndex differs";
  const optionsA = JSON.stringify(optionEntries(x.options));
  const optionsB = JSON.stringify(optionEntries(y.options));
  if (optionsA !== optionsB) return `options differ: ${optionsA} vs ${optionsB}`;
  const openA = x.openOption;
  const openB = y.openOption;
  if (openA?.option !== openB?.option || openA?.valueCount !== openB?.valueCount) return "openOption differs";
  if (x.directives && y.directives && JSON.stringify(x.directives) !== JSON.stringify(y.directives)) {
    return "directives differ";
  }
  return null;
}

function describe(outcome: Outcome): string {
  return outcome.ok ? "ok" : `${outcome.error.name}: ${outcome.error.message}`;
}

function errorFields(error: Error & Record<string, unknown>) {
  const { name, message, index, start, end, option, arg, value, validOptions } = error;
  return { name, message, index, start, end, option, arg, value, validOptions };
}

function sameItems<T>(a: readonly T[], b: readonly T[], same: (x: T, y: T) => boolean = Object.is): boolean {
  return a.length === b.length && a.every((item, i) => same(item, b[i]));
}

/**
 * The options map as `[name, group, values]`, where names that share one
 * values array get the same group number.
 */
function optionEntries(options: Map<string, string[]>): [string, number, string[]][] {
  const groups: string[][] = [];
  return [...options].map(([name, values]) => {
    let group = groups.indexOf(values);
    if (group === -1) group = groups.push(values) - 1;
    return [name, group, [...values]];
  });
}
