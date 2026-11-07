// Comparable snapshots of what `parse` and `readNext` return or throw, so two
// versions of the parser can be checked for differences.

import type { NextToken, ParseResult } from "../../src/parse.js";
import type { Action, Spec } from "../../src/types.js";

/**
 * A result of `parse` from this version or an older one. Before `parse` picked
 * the action, it returned every command action and option action instead.
 */
type AnyParseResult = Omit<ParseResult, "action"> & {
  action?: Action;
  actions?: Action[];
  optionActions?: Action[];
};

type Parse = (input: readonly string[], spec: Spec) => AnyParseResult;

export type Outcome =
  | { ok: true; result: AnyParseResult }
  | { ok: false; error: Error & Record<string, unknown> };

export function attempt(parse: Parse, input: readonly string[], spec: Spec): Outcome {
  try {
    return { ok: true, result: parse(input, spec) };
  } catch (error) {
    return { ok: false, error: error as Error & Record<string, unknown> };
  }
}

/**
 * Describe how two outcomes of `parse` differ, or return null if they match.
 * Spec objects (path entries, options, actions) must be the same objects.
 * `sameAction` decides whether two actions match, so two copies of the
 * built-in usage action can count as the same.
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
  if (!sameItems(x.path, y.path)) return "path differs";
  const [actionA, actionB] = [pickedAction(x), pickedAction(y)];
  if (actionA !== actionB && !(actionA && actionB && sameAction(actionA, actionB))) {
    return "action differs";
  }
  if (JSON.stringify(x.args) !== JSON.stringify(y.args)) {
    return `args differ: ${JSON.stringify(x.args)} vs ${JSON.stringify(y.args)}`;
  }
  if (x.argSeparatorIndex !== y.argSeparatorIndex) return "argSeparatorIndex differs";
  const optionsA = JSON.stringify(optionEntries(x.options));
  const optionsB = JSON.stringify(optionEntries(y.options));
  if (optionsA !== optionsB) return `options differ: ${optionsA} vs ${optionsB}`;
  return null;
}

/** Describe how two results of `readNext` differ, or return null if they match. */
export function nextDifference(x: NextToken, y: NextToken): string | null {
  if (!sameItems(x.path, y.path)) return "path differs";
  if (!sameItems(x.seenOptions, y.seenOptions)) return "seenOptions differ";
  if (JSON.stringify(x.scope.directives) !== JSON.stringify(y.scope.directives)) return "directives differ";
  if (x.optionsAllowed !== y.optionsAllowed) return "optionsAllowed differs";
  if (!sameItems(x.subcommands, y.subcommands)) return "subcommands differ";
  if (x.arg !== y.arg) return "arg differs";
  const [valueA, valueB] = [x.value, y.value];
  if (
    valueA?.option !== valueB?.option ||
    valueA?.arg !== valueB?.arg ||
    valueA?.required !== valueB?.required
  ) {
    return "value differs";
  }
  const [attachedA, attachedB] = [x.attached, y.attached];
  for (const key of ["option", "arg", "prefix", "value"] as const) {
    if (attachedA?.[key] !== attachedB?.[key]) return `attached ${key} differs`;
  }
  for (const option of [...x.scope.local, ...x.scope.persistent]) {
    if (x.conflicts(option) !== y.conflicts(option)) return "conflicts differ";
  }
  return null;
}

/** The action `run` would run for `result`, picked the way that version of `run` picks it. */
function pickedAction(result: AnyParseResult): Action | undefined {
  if (!result.actions) return result.action;
  return result.optionActions?.at(-1) ?? result.actions.at(-1);
}

function describe(outcome: Outcome): string {
  return outcome.ok ? "ok" : `${outcome.error.name}: ${outcome.error.message}`;
}

function errorFields(error: Error & Record<string, unknown>) {
  const { name, message, option, didYouMean } = error;
  return { name, message, option, didYouMean };
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
