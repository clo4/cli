/**
 * Argument lists: what a command's or an option's `args` holds, and the rules
 * for how many values it takes and which defaults fill in. The parser, help
 * and the spec checks all read an argument list through this module, so they
 * agree on which defaults are used.
 *
 * Each function takes `args` as written in the spec, without copying it into
 * an array, since the parser reads one for every command and option a command
 * line uses. They call `Array.isArray` and cast for the same reason, which
 * saves a cold start compiling a type guard.
 *
 * @module
 */

import type { Arg, Option } from "./types.js";

/** What a command's or an option's `args` holds: one argument, a list of them, or none. */
export type ArgList = Arg | readonly Arg[] | undefined;

/** The fewest values `args` takes: one for each argument before the first optional one. */
export function minArgs(args: ArgList): number {
  if (args === undefined) {
    return 0;
  }
  if (!Array.isArray(args)) {
    return (args as Arg).isOptional ? 0 : 1;
  }
  let count = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i].isOptional) {
      break;
    }
    count++;
  }
  return count;
}

/** The most values `args` takes: one for each argument, or any number if one is variadic. */
export function maxArgs(args: ArgList): number {
  if (args === undefined) {
    return 0;
  }
  if (!Array.isArray(args)) {
    return (args as Arg).isVariadic ? Infinity : 1;
  }
  // Backwards, since a variadic argument is usually the last one.
  for (let i = args.length - 1; i >= 0; i--) {
    if (args[i].isVariadic) {
      return Infinity;
    }
  }
  return args.length;
}

/** The argument the value at `index` is for: the one there, or a final variadic one. */
export function argAt(args: ArgList, index: number): Arg | undefined {
  if (args === undefined) {
    return undefined;
  }
  if (!Array.isArray(args)) {
    return index === 0 || (args as Arg).isVariadic ? (args as Arg) : undefined;
  }
  if (index < args.length) {
    return args[index];
  }
  const last = args[args.length - 1] as Arg | undefined;
  return last?.isVariadic ? last : undefined;
}

/** Whether one of the arguments has a parser. */
export function hasParse(args: ArgList): boolean {
  if (args === undefined) {
    return false;
  }
  if (!Array.isArray(args)) {
    return (args as Arg).parse !== undefined;
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i].parse !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * Fill in the arguments a use of `args` left out: after the `given` values in
 * `values`, add the default of each argument from there on, up to the first
 * without one. Nothing fills in until every required argument is given, so a
 * default never takes a required argument's place.
 */
export function addDefaults(values: string[], args: ArgList, given: number): void {
  if (args !== undefined && given >= minArgs(args)) {
    pushDefaults(values, args, given);
  }
}

/**
 * What an action reads for `option` when it isn't used: the {@link leadingDefaults}
 * of its arguments. An option whose first argument is optional, like
 * `--inspect[=port]`, means something different when it's left out than when
 * it's bare, so its defaults are only for the bare option. Undefined if it has
 * none.
 */
export function unusedDefaults(option: Option): string[] | undefined {
  const first = argAt(option.args, 0);
  if (first === undefined || first.isOptional) {
    return undefined;
  }
  const values = leadingDefaults(option.args);
  return values.length > 0 ? values : undefined;
}

/**
 * The defaults of the arguments from the first on, up to the first without
 * one. They're what an option reads when it's left out, or when it's used
 * bare if its first argument is optional, so help shows these for an option.
 */
export function leadingDefaults(args: ArgList): string[] {
  const values: string[] = [];
  if (args !== undefined) {
    pushDefaults(values, args, 0);
  }
  return values;
}

/** The name an argument goes by in help and messages, or `fallback` if it has none. */
export function argName(arg: Arg, fallback = "argument"): string {
  return arg.name || fallback;
}

/** Add the defaults of the arguments from index `from` on to `values`, up to the first without one. */
function pushDefaults(values: string[], args: Arg | readonly Arg[], from: number): void {
  if (!Array.isArray(args)) {
    const value = (args as Arg).default;
    if (from === 0 && value !== undefined) {
      values.push(value);
    }
    return;
  }
  for (let i = from; i < args.length; i++) {
    const value = args[i].default;
    if (value === undefined) {
      return;
    }
    values.push(value);
  }
}
