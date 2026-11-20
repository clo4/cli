/**
 * Runs each argument's parser on a command line the command-line parser has
 * accepted. It's a module of its own, and the command-line parser only calls
 * it for a command line with an argument's parser to run, so a spec without
 * one never compiles it.
 *
 * @module
 */

import type { Arg, Option, StandardResult, StandardSchemaV1 } from "./types.js";
import { InvalidValue, problemsError } from "./errors.js";
import { choicesOf } from "./schemas.js";
import type { ErrorContext, ParseError } from "./errors.js";
import { argAt, argName, unusedDefaults } from "./args.js";
import type { ArgList } from "./args.js";
import { asArray, describeThrown } from "./util.js";

/** The values one use of an option took, for an option with a parser. */
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

/**
 * What the parser hands over: the strings it read, and where each came from.
 * Each value is parsed in place, so every name an option's values are stored
 * under, and every use of a repeatable option, reads what they parsed to.
 */
export interface Unparsed {
  context: ErrorContext;
  /** What's wrong with the command line so far. Rejected values are added to it. */
  problems: ParseError[] | null;
  /** The positional arguments, with defaults from index `typedArgs` on. */
  args: unknown[];
  typedArgs: number;
  /** The arguments of the selected command. */
  argSpecs: ArgList;
  uses: readonly ParsedUse[] | null;
  /** The options that weren't used, whose defaults an action can still read. */
  unused: readonly Option[];
}

/** A value its parser rejected, with what that parser said about the value. */
export class Rejected {
  constructor(readonly reason: string) {}
}

/** One string to parse, at `values[index]`, where what it parses to goes. */
interface Job {
  arg: Arg & { parse: StandardSchemaV1 };
  raw: string;
  /** What the value is for, as the user would write it. */
  target: string;
  isDefault: boolean;
  values: unknown[];
  index: number;
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

/**
 * What `schema` gives for `raw`: the value, or a `Rejected`. A schema reports
 * a value it rejects as issues, so one that throws has a bug, and its message
 * is shown as the reason all the same.
 */
export async function apply(schema: StandardSchemaV1, raw: string): Promise<unknown> {
  try {
    return readResult(await schema["~standard"].validate(raw));
  } catch (thrown) {
    return new Rejected(describeThrown(thrown));
  }
}

/** The jobs for the values from `start` to `end` of `values`, which are the arguments `args` in order. */
function addJobs(
  jobs: Job[],
  args: ArgList,
  values: unknown[],
  start: number,
  typedEnd: number,
  end: number,
  target: string | null,
): void {
  for (let i = start; i < end; i++) {
    const arg = argAt(args, i - start);
    if (arg?.parse !== undefined) {
      jobs.push({
        arg: arg as Job["arg"],
        raw: values[i] as string,
        // An option with several arguments says which one the value is for.
        target:
          target === null
            ? `<${argName(arg)}>`
            : Array.isArray(args) && args.length > 1
              ? `${target} <${argName(arg, `argument ${i - start + 1}`)}>`
              : target,
        isDefault: i >= typedEnd,
        values,
        index: i,
      });
    }
  }
}

/**
 * Run each argument's parser on the values in `unparsed`, and put what each
 * value parsed to in its place. Resolves to what the defaults of each unused
 * option parsed to. Rejects with every problem together, the ones the
 * command-line parser found and each value its parser rejected.
 */
export async function parseValues(unparsed: Unparsed): Promise<Map<Option, unknown[]> | null> {
  const jobs: Job[] = [];
  const { args } = unparsed;
  addJobs(jobs, unparsed.argSpecs, args, 0, unparsed.typedArgs, args.length, null);
  for (const use of unparsed.uses ?? []) {
    addJobs(jobs, use.option.args, use.values, use.start, use.typedEnd, use.end, use.name);
  }
  let defaults: Map<Option, unknown[]> | null = null;
  for (const option of unparsed.unused) {
    const values = unusedDefaults(option);
    if (values) {
      (defaults ??= new Map()).set(option, values);
      addJobs(jobs, option.args, values, 0, 0, values.length, asArray(option.name).join("/"));
    }
  }

  const results = await Promise.all(jobs.map((job) => apply(job.arg.parse, job.raw)));
  let problems = unparsed.problems;
  // Positional arguments first, then options in the order used, whichever
  // parser settled first.
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const result = results[i];
    if (result instanceof Rejected) {
      (problems ??= []).push(
        new InvalidValue(
          job.raw,
          job.target,
          result.reason,
          job.isDefault,
          unparsed.context,
          choicesOf(job.arg),
        ),
      );
    } else {
      job.values[job.index] = result;
    }
  }
  if (problems) {
    throw problemsError(problems);
  }
  return defaults;
}
