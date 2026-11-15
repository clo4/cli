/**
 * Runs each `parse` on a command line the parser has accepted. It's a module
 * of its own, and the parser only calls it for a command line that has a
 * `parse` to run, so a spec without one never compiles it.
 *
 * @module
 */

import type { Arg, Option, StandardResult, StandardSchemaV1 } from "./types.js";
import { InvalidValue, problemsError } from "./errors.js";
import type { ErrorContext, ParseError } from "./errors.js";
import { addDefaults, argAt, asArray, describeThrown } from "./util.js";

/** The values one use of an option took, for an option with a `parse`. */
export interface ParsedUse {
  option: Option;
  /** The name the option was used by. */
  name: string;
  /** The option's values. A repeatable option keeps the values of every use here. */
  values: string[];
  /** Where this use's values start in `values`, where the ones the user typed end, and where the defaults after them end. */
  start: number;
  typedEnd: number;
  end: number;
}

/** What the parser hands over: the strings it read, and where each came from. */
export interface Unparsed {
  context: ErrorContext;
  /** What's wrong with the command line so far. Rejected values are added to it. */
  problems: ParseError[] | null;
  /** The positional arguments, with defaults from index `typedArgs` on. */
  args: string[];
  typedArgs: number;
  /** The arguments of the selected command. */
  argSpecs: readonly Arg[];
  /** The values of each name used, which are replaced with what they parse to. */
  options: Map<string, unknown[]>;
  uses: readonly ParsedUse[] | null;
  /** The options that weren't used, whose defaults an action can still read. */
  unused: readonly Option[];
}

/** What the strings parsed to. */
export interface ParsedValues {
  args: unknown[];
  /** What the defaults of each unused option parsed to. */
  defaults: Map<Option, unknown[]> | null;
}

/** A value a `parse` rejected, with what it said about the value. */
export class Rejected {
  constructor(readonly reason: string) {}
}

/** One string to parse, and where the result goes. */
interface Job {
  schema: StandardSchemaV1;
  raw: string;
  /** What the value is for, as the user would write it. */
  target: string;
  isDefault: boolean;
  into: unknown[];
  index: number;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as PromiseLike<unknown> | null | undefined)?.then === "function";
}

function readResult(result: StandardResult<unknown>): unknown {
  if (result.issues) {
    const reasons: string[] = [];
    for (const issue of result.issues) {
      reasons.push(issue.message);
    }
    return new Rejected(reasons.join("; "));
  }
  return result.value;
}

function reject(thrown: unknown): Rejected {
  return new Rejected(describeThrown(thrown));
}

/**
 * What `schema` gives for `raw`: the value, a `Rejected`, or a promise of
 * either. A schema reports a value it rejects as issues, so one that throws
 * has a bug, and its message is shown as the reason all the same.
 */
export function apply(schema: StandardSchemaV1, raw: string): unknown {
  try {
    const result = schema["~standard"].validate(raw);
    return isThenable(result) ? result.then(readResult, reject) : readResult(result);
  } catch (thrown) {
    return reject(thrown);
  }
}

/** The jobs for the values from `start` to `end` of `raw`, which are the arguments `args` in order. */
function addJobs(
  jobs: Job[],
  args: readonly Arg[],
  raw: readonly string[],
  into: unknown[],
  start: number,
  typedEnd: number,
  end: number,
  target: string | null,
): void {
  for (let i = start; i < end; i++) {
    const arg = argAt(args, i - start);
    if (arg?.parse !== undefined) {
      jobs.push({
        schema: arg.parse,
        raw: raw[i],
        // An option with several arguments says which one the value is for.
        target:
          target === null
            ? `<${arg.name ?? "argument"}>`
            : args.length > 1
              ? `${target} <${arg.name ?? `argument ${i - start + 1}`}>`
              : target,
        isDefault: i >= typedEnd,
        into,
        index: i,
      });
    }
  }
}

/**
 * Run every `parse` for the values in `unparsed`, and replace each value in
 * `unparsed.options` with what it parsed to. Throws every problem together,
 * the ones the parser found and each value a `parse` rejected. Gives a
 * promise only if a `parse` did.
 */
export function parseValues(unparsed: Unparsed): ParsedValues | Promise<ParsedValues> {
  const jobs: Job[] = [];
  const args: unknown[] = unparsed.args.slice();
  addJobs(jobs, unparsed.argSpecs, unparsed.args, args, 0, unparsed.typedArgs, args.length, null);

  // Every name of an option holds the same array, and a repeatable option
  // keeps one array for all its uses, so each array is copied once.
  const copies = new Map<readonly unknown[], unknown[]>();
  for (const use of unparsed.uses ?? []) {
    let into = copies.get(use.values);
    if (!into) {
      into = use.values.slice();
      copies.set(use.values, into);
    }
    addJobs(jobs, asArray(use.option.args), use.values, into, use.start, use.typedEnd, use.end, use.name);
  }
  for (const [name, values] of unparsed.options) {
    const copy = copies.get(values);
    if (copy) {
      unparsed.options.set(name, copy);
    }
  }

  let defaults: Map<Option, unknown[]> | null = null;
  for (const option of unparsed.unused) {
    const optionArgs = asArray(option.args);
    // Only an option whose first argument is required has defaults to read
    // when it's left out. See `unusedDefaults` in the parser.
    if (optionArgs.length === 0 || optionArgs[0].isOptional) {
      continue;
    }
    const raw: string[] = [];
    addDefaults(raw, optionArgs);
    if (raw.length === 0) {
      continue;
    }
    const into: unknown[] = raw.slice();
    (defaults ??= new Map()).set(option, into);
    addJobs(jobs, optionArgs, raw, into, 0, 0, raw.length, asArray(option.name).join("/"));
  }

  let waiting: PromiseLike<void>[] | null = null;
  const rejected: (Rejected | undefined)[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const settle = (value: unknown): void => {
      if (value instanceof Rejected) {
        rejected[i] = value;
      } else {
        job.into[job.index] = value;
      }
    };
    const value = apply(job.schema, job.raw);
    if (isThenable(value)) {
      (waiting ??= []).push(value.then(settle));
    } else {
      settle(value);
    }
  }

  const finish = (): ParsedValues => {
    let problems = unparsed.problems;
    // Positional arguments first, then options in the order used, whichever
    // `parse` settled first.
    for (let i = 0; i < jobs.length; i++) {
      const reason = rejected[i];
      if (reason) {
        const { raw, target, isDefault } = jobs[i];
        (problems ??= []).push(new InvalidValue(raw, target, reason.reason, isDefault, unparsed.context));
      }
    }
    if (problems) {
      throw problemsError(problems);
    }
    return { args, defaults };
  };
  return waiting ? Promise.all(waiting).then(finish) : finish();
}
