// Random specs and command lines for the fuzz tests. Everything comes from one
// seeded generator, so a seed and case number reproduce a failure exactly.

import type { Action, Arg, Option, Spec, Subcommand } from "../../src/types.js";

export interface Random {
  next(): number;
  int(n: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
}

/** A small, fast seeded generator (mulberry32). */
export function random(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (n: number) => Math.floor(next() * n);
  return {
    next,
    int,
    chance: (p) => next() < p,
    pick: (items) => items[int(items.length)],
  };
}

// Names overlap on purpose: short and long options that share characters,
// subcommand names that are prefixes of each other or look like options, and
// odd ones like "-", "+", "" and "--".
export const OPTION_NAMES = [
  "-a",
  "-b",
  "-c",
  "-v",
  "-o",
  "--foo",
  "--bar",
  "--f",
  "--foo-bar",
  "-",
  "+",
  "+x",
  "+a",
  "/x",
  "x",
  "build",
  "-5",
  "--",
];
const SUBCOMMAND_NAMES = [
  "build",
  "b",
  "bu",
  "bun",
  "run",
  "r",
  "rm",
  "remove",
  "x",
  "",
  "-a",
  "--foo",
  "val",
];
const SEPARATORS = ["=", ":", "==", ["=", ":"], [":", "="], ["=", "=="], ["==", "="], []] as const;
const VALUES = ["1", "", "a=b", "-a", "b"];
const LOOSE_TOKENS = [
  "--",
  "",
  "-",
  "+",
  "x",
  "val",
  "-5",
  "--unknown",
  "-z",
  "-az",
  "-ab",
  "-abc",
  "-oval",
  "-o=val",
  "-o:val",
  "-a=",
  "+xa",
  "+5",
  "--foo=1",
  "--foo:1",
  "--foo==1",
  "--foo=a:b",
  "--foo:a=b",
  "--bar=",
  "/x",
  "/x=1",
  "x=1",
  "build=1",
  "---",
  "-=",
  "=",
  ":",
];

export interface GenerateOptions {
  /** Include empty strings in `optionArgSeparators`, which spec validation rejects. */
  emptySeparators?: boolean;
  /**
   * Give some arguments a `default`. The defaults come from a random generator
   * of their own, so the spec is otherwise the same as without them.
   */
  defaults?: boolean;
}

// Odd values too, so a default that looks like an option or `--` can't change
// how anything else reads.
const DEFAULT_VALUES = ["d", "", "-v", "--", "build"];

/** Create a generator of random specs and command lines from one seed. */
export function generator(seed: number, options: GenerateOptions = {}) {
  const r = random(seed);
  const defaults = random(seed ^ 0x5eed);
  let actionCount = 0;

  const action = (): Action => {
    const id = actionCount++;
    return Object.defineProperty(() => {}, "name", { value: `action${id}` });
  };

  const args = (): Arg | Arg[] | undefined => {
    const one = (): Arg => ({
      name: "v",
      ...(r.chance(0.3) ? { isOptional: true } : {}),
      ...(r.chance(0.25) ? { isVariadic: true } : {}),
      ...(options.defaults && defaults.chance(0.5) ? { default: defaults.pick(DEFAULT_VALUES) } : {}),
    });
    const kind = r.int(6);
    if (kind < 2) return undefined;
    if (kind < 4) return one();
    return Array.from({ length: 1 + r.int(3) }, one);
  };

  const names = (pool: readonly string[]) =>
    r.chance(0.3) ? Array.from({ length: 2 + r.int(2) }, () => r.pick(pool)) : r.pick(pool);

  const option = (): Option => {
    const o: Record<string, unknown> = { name: names(OPTION_NAMES) };
    const a = args();
    if (a) o.args = a;
    if (r.chance(0.25)) o.isRepeatable = r.chance(0.5) ? true : 1 + r.int(3);
    if (r.chance(0.15)) o.requiresSeparator = r.chance(0.5) ? true : r.pick(["=", ":", "=="]);
    if (r.chance(0.3)) o.isPersistent = true;
    if (r.chance(0.1)) o.isRequired = true;
    if (r.chance(0.1)) o.dependsOn = [r.pick(OPTION_NAMES)];
    if (r.chance(0.1)) o.exclusiveOn = [r.pick(OPTION_NAMES)];
    if (r.chance(0.15)) o.action = action();
    return o as unknown as Option;
  };

  const command = (depth: number): Record<string, unknown> => {
    const c: Record<string, unknown> = {};
    if (r.chance(0.85)) c.options = Array.from({ length: r.int(6) }, option);
    const a = args();
    if (a) c.args = a;
    if (r.chance(0.3)) c.action = action();
    if (r.chance(0.15)) c.requiresSubcommand = true;
    if (r.chance(0.5)) {
      const d: Record<string, unknown> = {};
      if (r.chance(0.4)) {
        d.optionArgSeparators = r.pick(SEPARATORS);
        if (options.emptySeparators && r.chance(0.2))
          d.optionArgSeparators = r.pick(["", ["", "="], ["=", ""]]);
      }
      if (r.chance(0.4)) d.subcommandsMatchUniquePrefix = r.chance(0.7);
      if (r.chance(0.3)) d.optionsMustPrecedeArguments = r.chance(0.6);
      if (r.chance(0.3)) d.flagsArePosixNoncompliant = r.chance(0.5);
      c.parserDirectives = d;
    }
    if (depth < 3 && r.chance(0.6)) {
      c.subcommands = Array.from({ length: 1 + r.int(4) }, () => ({
        name: names(SUBCOMMAND_NAMES),
        ...command(depth + 1),
      }));
    }
    return c;
  };

  const spec = (): Spec => ({ name: "fuzz", ...command(0) }) as Spec;

  /** A command line for `s`, mostly made of names from the spec itself. */
  const input = (s: Spec): string[] => {
    const optionNames: string[] = [];
    const subcommandNames: string[] = [];
    const collect = (c: Spec | Subcommand) => {
      for (const o of c.options ?? []) optionNames.push(...[o.name].flat());
      for (const sub of c.subcommands ?? []) {
        subcommandNames.push(...[sub.name].flat());
        collect(sub);
      }
    };
    collect(s);

    const token = (): string => {
      if (r.chance(0.5) && (optionNames.length || subcommandNames.length)) {
        const kind = r.int(6);
        if (subcommandNames.length && kind < 2) return r.pick(subcommandNames);
        if (subcommandNames.length && kind < 3) {
          const name = r.pick(subcommandNames);
          return name.slice(0, 1 + r.int(Math.max(1, name.length)));
        }
        if (optionNames.length && kind < 5) return r.pick(optionNames);
        if (optionNames.length) return r.pick(optionNames) + r.pick(["=", ":", "==", ""]) + r.pick(VALUES);
      }
      const kind = r.int(10);
      if (kind < 3) return r.pick(LOOSE_TOKENS);
      if (kind < 5) return r.pick(SUBCOMMAND_NAMES);
      if (kind < 6) {
        const name = r.pick(SUBCOMMAND_NAMES);
        return name.slice(0, Math.max(0, name.length - 1 - r.int(2)));
      }
      if (kind < 8) return r.pick(OPTION_NAMES);
      if (kind < 9) return r.pick(OPTION_NAMES) + r.pick(["=", ":", "==", ""]) + r.pick(VALUES.slice(0, 4));
      const chars = ["a", "b", "c", "v", "o", "5", "=", "x", "z"];
      return r.pick(["-", "+"]) + Array.from({ length: 1 + r.int(3) }, () => r.pick(chars)).join("");
    };

    return Array.from({ length: r.int(7) }, token);
  };

  return { spec, input, random: r };
}

/**
 * Make a failing case smaller. Tries removing tokens, array items and object
 * keys (except `name`) one at a time, keeping any change that still fails,
 * until nothing more can go.
 */
export function shrink(
  spec: Spec,
  input: string[],
  fails: (spec: Spec, input: string[]) => boolean,
): { spec: Spec; input: string[] } {
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < input.length; i++) {
      const smaller = without(input, i);
      if (fails(spec, smaller)) {
        input = smaller;
        changed = true;
        i--;
      }
    }
    for (const smaller of smallerValues(spec)) {
      if (fails(smaller as Spec, input)) {
        spec = smaller as Spec;
        changed = true;
        break;
      }
    }
  }
  return { spec, input };
}

/** Every copy of `value` with one array item or object key removed, at any depth. */
function* smallerValues(value: unknown): Generator<unknown> {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield without(value, i);
    for (let i = 0; i < value.length; i++) {
      for (const item of smallerValues(value[i])) yield replaced(value, i, item);
    }
    return;
  }
  if (value === null || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key === "name") continue;
    const { [key]: _, ...rest } = record;
    yield rest;
  }
  for (const key of Object.keys(record)) {
    for (const item of smallerValues(record[key])) yield { ...record, [key]: item };
  }
}

function without<T>(items: readonly T[], i: number): T[] {
  return [...items.slice(0, i), ...items.slice(i + 1)];
}

function replaced<T>(items: readonly T[], i: number, item: T): T[] {
  const copy = items.slice();
  copy[i] = item;
  return copy;
}

/** Show a spec as JSON, with actions by name and Infinity spelled out. */
export function showSpec(spec: Spec): string {
  return JSON.stringify(spec, (_, v: unknown) =>
    typeof v === "function" ? `<${v.name}>` : v === Infinity ? "Infinity" : v,
  );
}
