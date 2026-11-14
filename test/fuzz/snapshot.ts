// Comparable snapshots of what `parse` and `readNext` return or throw, so two
// reads of the same command line can be checked for differences.

import type { NextToken, ParseResult } from "../../src/parse.js";
import type { Action, Spec, Subcommand } from "../../src/types.js";

/** Whether two commands are the same one, for specs that hold the same commands as different objects. */
type SameCommand = (x: Spec | Subcommand, y: Spec | Subcommand) => boolean;

type Parse = (input: readonly string[], spec: Spec) => ParseResult;

export type Outcome =
  | { ok: true; result: ParseResult }
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
 * `sameAction` decides whether two actions match, and `sameCommand` whether
 * two commands on a path do. What `has`, `get`, `all` and `count` return for
 * each of `optionNames` is compared too.
 */
export function difference(
  a: Outcome,
  b: Outcome,
  sameAction: (x: Action, y: Action) => boolean = Object.is,
  optionNames: readonly string[] = [],
  sameCommand: SameCommand = Object.is,
): string | null {
  if (a.ok !== b.ok) {
    return a.ok ? `only the second threw: ${describe(b)}` : `only the first threw: ${describe(a)}`;
  }
  if (!a.ok || !b.ok) {
    const x = a.ok ? null : errorFields(a.error);
    const y = b.ok ? null : errorFields(b.error);
    if (JSON.stringify(x) !== JSON.stringify(y)) {
      return `errors differ: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`;
    }
    const pathA = (a.ok ? null : (a.error.context as { path: Subcommand[] } | undefined))?.path ?? [];
    const pathB = (b.ok ? null : (b.error.context as { path: Subcommand[] } | undefined))?.path ?? [];
    return sameItems(pathA, pathB, sameCommand) ? null : "error paths differ";
  }
  const x = a.result;
  const y = b.result;
  if (!sameItems(x.path, y.path, sameCommand)) {
    return "path differs";
  }
  if (!sameAction(x.action, y.action)) {
    return "action differs";
  }
  if (JSON.stringify(x.args) !== JSON.stringify(y.args)) {
    return `args differ: ${JSON.stringify(x.args)} vs ${JSON.stringify(y.args)}`;
  }
  if (x.argSeparatorIndex !== y.argSeparatorIndex) {
    return "argSeparatorIndex differs";
  }
  const optionsA = JSON.stringify(optionEntries(x.options.options));
  const optionsB = JSON.stringify(optionEntries(y.options.options));
  if (optionsA !== optionsB) {
    return `options differ: ${optionsA} vs ${optionsB}`;
  }
  for (const name of optionNames) {
    for (const question of ["has", "get", "all", "count"] as const) {
      const answerA = JSON.stringify(x.options[question](name));
      const answerB = JSON.stringify(y.options[question](name));
      if (answerA !== answerB) {
        return `${question}(${JSON.stringify(name)}) differs: ${answerA} vs ${answerB}`;
      }
    }
  }
  return null;
}

/**
 * Describe how two results of `readNext` differ, or return null if they
 * match. `sameCommand` decides whether two commands match.
 */
export function nextDifference(
  x: NextToken,
  y: NextToken,
  sameCommand: SameCommand = Object.is,
): string | null {
  if (!sameItems(x.path, y.path, sameCommand)) {
    return "path differs";
  }
  if (JSON.stringify(x.directives) !== JSON.stringify(y.directives)) {
    return "directives differ";
  }
  if (x.optionsAllowed !== y.optionsAllowed) {
    return "optionsAllowed differs";
  }
  const sameSubcommand = (a: NextToken["subcommands"][number], b: NextToken["subcommands"][number]) =>
    sameCommand(a.command, b.command) && sameItems(a.names, b.names);
  if (!sameItems(x.subcommands, y.subcommands, sameSubcommand)) {
    return "subcommands differ";
  }
  if (x.arg !== y.arg) {
    return "arg differs";
  }
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
    if (attachedA?.[key] !== attachedB?.[key]) {
      return `attached ${key} differs`;
    }
  }
  if (x.partialIsOption !== y.partialIsOption) {
    return "partialIsOption differs";
  }
  if (x.options.length !== y.options.length) {
    return "options differ";
  }
  for (let i = 0; i < x.options.length; i++) {
    const [a, b] = [x.options[i], y.options[i]];
    const sameForms = sameItems(a.forms, b.forms, (f, g) => f.name === g.name && f.join === g.join);
    if (a.option !== b.option || a.used !== b.used || !sameForms) {
      return `options differ at ${i}`;
    }
  }
  return null;
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
export function optionEntries(options: Map<string, string[]>): [string, number, string[]][] {
  const groups: string[][] = [];
  return [...options].map(([name, values]) => {
    let group = groups.indexOf(values);
    if (group === -1) {
      group = groups.push(values) - 1;
    }
    return [name, group, [...values]];
  });
}
