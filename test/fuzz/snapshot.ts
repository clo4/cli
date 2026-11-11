// Comparable snapshots of what `parse` and `readNext` return or throw, so two
// versions of the parser can be checked for differences.

import type { NextToken, ParseResult } from "../../src/parse.js";
import type { Action, OptionArgs, Spec, Subcommand } from "../../src/types.js";
import { asArray } from "../../src/util.js";

/**
 * A result of `parse` from this version or an older one. Before `parse` picked
 * the action, it returned every command action and option action instead.
 * Before `parse` returned the options as the action receives them, it
 * returned the map of option names to values, and `defaults` gave the
 * defaults of an unused option.
 */
type AnyParseResult = Omit<ParseResult, "action" | "options"> & {
  options: OptionArgs | Map<string, string[]>;
  /** Before `parse` had defaults, results didn't have this. */
  defaults?: (name: string) => string[] | undefined;
  action?: Action;
  actions?: Action[];
  optionActions?: Action[];
};

type Parse<R> = (input: readonly string[], spec: Spec) => R;

export type Outcome<R extends AnyParseResult = AnyParseResult> =
  | { ok: true; result: R }
  | { ok: false; error: Error & Record<string, unknown> };

export function attempt<R extends AnyParseResult>(
  parse: Parse<R>,
  input: readonly string[],
  spec: Spec,
): Outcome<R> {
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
 * built-in usage action can count as the same. What `has`, `get`, `all` and
 * `count` return for each of `optionNames` is compared too, and so are the
 * defaults of each when both versions have defaults.
 */
export function difference(
  a: Outcome,
  b: Outcome,
  sameAction: (x: Action, y: Action) => boolean = Object.is,
  optionNames: readonly string[] = [],
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
    const pathA = (a.ok ? null : (a.error.context as { path: unknown[] } | undefined))?.path ?? [];
    const pathB = (b.ok ? null : (b.error.context as { path: unknown[] } | undefined))?.path ?? [];
    return sameItems(pathA, pathB) ? null : "error paths differ";
  }
  const x = a.result;
  const y = b.result;
  if (!sameItems(x.path, y.path)) {
    return "path differs";
  }
  const [actionA, actionB] = [pickedAction(x), pickedAction(y)];
  if (actionA !== actionB && !(actionA && actionB && sameAction(actionA, actionB))) {
    return "action differs";
  }
  if (JSON.stringify(x.args) !== JSON.stringify(y.args)) {
    return `args differ: ${JSON.stringify(x.args)} vs ${JSON.stringify(y.args)}`;
  }
  if (x.argSeparatorIndex !== y.argSeparatorIndex) {
    return "argSeparatorIndex differs";
  }
  const optionsA = JSON.stringify(optionEntries(optionMap(x)));
  const optionsB = JSON.stringify(optionEntries(optionMap(y)));
  if (optionsA !== optionsB) {
    return `options differ: ${optionsA} vs ${optionsB}`;
  }
  const [defaultsOfA, defaultsOfB] = [defaultsOf(x), defaultsOf(y)];
  if (defaultsOfA && defaultsOfB) {
    for (const name of optionNames) {
      const [defaultsA, defaultsB] = [JSON.stringify(defaultsOfA(name)), JSON.stringify(defaultsOfB(name))];
      if (defaultsA !== defaultsB) {
        return `defaults of ${name} differ: ${defaultsA} vs ${defaultsB}`;
      }
    }
  }
  const [argsA, argsB] = [optionArgsOf(x), optionArgsOf(y)];
  for (const name of optionNames) {
    for (const question of ["has", "get", "all", "count"] as const) {
      const [answerA, answerB] = [
        JSON.stringify(argsA[question](name)),
        JSON.stringify(argsB[question](name)),
      ];
      if (answerA !== answerB) {
        return `${question}(${JSON.stringify(name)}) differs: ${answerA} vs ${answerB}`;
      }
    }
  }
  return null;
}

/** Whether the version of `parse` that returned `result` has defaults. */
export function hasDefaults(result: AnyParseResult): boolean {
  return defaultsOf(result) !== undefined;
}

/** The map of option names to values, from either version. */
function optionMap(result: AnyParseResult): Map<string, string[]> {
  const options = result.options;
  return options instanceof Map ? options : options.options;
}

/**
 * The defaults of each unused option, from either version. Where `parse`
 * returns the options as the action receives them, `all` gives the defaults
 * of an unused option.
 */
function defaultsOf(result: AnyParseResult): ((name: string) => string[] | undefined) | undefined {
  const options = result.options;
  if (options instanceof Map) {
    return result.defaults;
  }
  return (name) => (options.has(name) ? undefined : options.all(name));
}

/**
 * The options as the action receives them, from either version. Where `parse`
 * returned the map, they're made the way that version's `run` made them.
 */
function optionArgsOf(result: AnyParseResult): OptionArgs {
  const options = result.options;
  if (!(options instanceof Map)) {
    return options;
  }
  const defaults = result.defaults ?? (() => undefined);
  return {
    options,
    has: (name) => options.has(name),
    get: (name) => (options.get(name) ?? defaults(name))?.[0],
    all: (name) => options.get(name) ?? defaults(name),
    count: (name) => options.get(name)?.length ?? 0,
  };
}

/**
 * A result of `readNext` from this version or an older one. Before `readNext`
 * listed the usable options, it returned the option scope, every option used,
 * and a function to check each option's rules.
 */
export type AnyNextToken = Omit<NextToken, "directives" | "options" | "subcommands"> & {
  directives?: NextToken["directives"];
  options?: readonly AnyUsableOption[];
  scope?: { directives: NextToken["directives"] };
  subcommands: readonly (NextToken["subcommands"][number] | Subcommand)[];
};

/**
 * Each subcommand the token can name, paired with each name that refers to
 * it. Before `readNext` listed those names, it listed the subcommands alone,
 * and every name of one referred to it.
 */
function subcommandNames(next: AnyNextToken): [Subcommand, string][] {
  return next.subcommands.flatMap((item): [Subcommand, string][] =>
    "command" in item
      ? item.names.map((name): [Subcommand, string] => [item.command, name])
      : asArray(item.name).map((name): [Subcommand, string] => [item, name]),
  );
}

/**
 * A usable option from this version or an older one. Before options listed
 * how each name is written, they listed the names and one separator.
 */
type AnyUsableOption = Omit<NextToken["options"][number], "forms"> & {
  forms?: NextToken["options"][number]["forms"];
  names?: readonly string[];
  separator?: string | null;
};

/** The names that read as a usable option, from either version. */
function namesOf(usable: AnyUsableOption): string[] {
  if (!usable.forms) {
    return [...(usable.names ?? [])];
  }
  return usable.forms.map((form) => form.name);
}

/** How each name is written, if both versions say so the same way. */
function sameForms(a: AnyUsableOption, b: AnyUsableOption): boolean {
  if (a.forms && b.forms) {
    return sameItems(a.forms, b.forms, (x, y) => x.name === y.name && x.join === y.join);
  }
  if (a.forms || b.forms) {
    return true;
  }
  return a.separator === b.separator;
}

/**
 * Describe how two results of `readNext` differ, or return null if they match.
 * The usable options are only compared when both versions list them, and how
 * their names are written only when both versions say it the same way.
 */
export function nextDifference(x: AnyNextToken, y: AnyNextToken): string | null {
  if (!sameItems(x.path, y.path)) {
    return "path differs";
  }
  const directives = (next: AnyNextToken) => JSON.stringify(next.directives ?? next.scope?.directives);
  if (directives(x) !== directives(y)) {
    return "directives differ";
  }
  if (x.optionsAllowed !== y.optionsAllowed) {
    return "optionsAllowed differs";
  }
  if (!sameItems(subcommandNames(x), subcommandNames(y), (a, b) => a[0] === b[0] && a[1] === b[1])) {
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
  if (x.options && y.options) {
    if (x.options.length !== y.options.length) {
      return "options differ";
    }
    for (let i = 0; i < x.options.length; i++) {
      const [a, b] = [x.options[i], y.options[i]];
      if (
        a.option !== b.option ||
        a.used !== b.used ||
        !sameItems(namesOf(a), namesOf(b)) ||
        !sameForms(a, b)
      ) {
        return `options differ at ${i}`;
      }
    }
  }
  return null;
}

/** The action `run` would run for `result`, picked the way that version of `run` picks it. */
function pickedAction(result: AnyParseResult): Action | undefined {
  if (!result.actions) {
    return result.action;
  }
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
    if (group === -1) {
      group = groups.push(values) - 1;
    }
    return [name, group, [...values]];
  });
}
