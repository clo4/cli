/**
 * Runs each argument's parser on a command line the command-line parser has
 * accepted. It's a module of its own, and the command-line parser only calls
 * it for a command line with an argument's parser to run, so a spec without
 * one never compiles it.
 *
 * @module
 */

import type { Arg, Option, StandardResult, StandardSchemaV1 } from "./types.js";
import { invalidValue, optionNames, problemsError } from "./errors.js";
import { describeParser } from "./description.js";
import type { ErrorContext, ParseError } from "./errors.js";
import { argAt, argName, unusedDefaults } from "./args.js";
import type { ArgList } from "./args.js";
import { describeThrown } from "./util.js";

/**
 * Values the parser read for an argument list: a command's positional
 * arguments, one use of an option, or the defaults of an option that wasn't
 * used. Each value is parsed in place, so every name an option's values are
 * stored under, and every use of a repeatable option, reads what they parsed
 * to.
 */
export interface Given {
  /** The arguments the values are for, from `start` on. */
  args: ArgList;
  /** The option the values are for, as the user would write it, or null for positional arguments. */
  option: string | null;
  /** The values. A repeatable option keeps the values of every use here. */
  values: unknown[];
  /** Where these values start in `values`, where the ones the user typed end, and where the defaults after them end. */
  start: number;
  typedEnd: number;
  end: number;
  /** The index of the token each typed value is in, from `start` on. */
  tokens: readonly number[];
  /** Where a value attached to its option starts in its token. */
  tokenStart?: number;
}

/** What {@link parseValues} reads. */
export interface Unparsed {
  context: ErrorContext;
  /** What's wrong with the command line so far. Rejected values are added to it. */
  problems: ParseError[] | null;
  /** The values typed for arguments with a parser, positional arguments first. */
  given: readonly Given[];
  /** The options that weren't used, whose defaults an action can still read. */
  unused: readonly Option[];
}

/** A value its parser rejected, with what that parser said about the value. */
export class Rejected {
  constructor(readonly reason: string) {}
}

/** One value to parse: `given.values[index]`, which is for `arg`. What it parses to goes in its place. */
interface Job {
  arg: Arg & { parse: StandardSchemaV1 };
  given: Given;
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

/** Add a job for each of the values in `given` whose argument has a parser. */
function addJobs(jobs: Job[], given: Given): void {
  for (let i = given.start; i < given.end; i++) {
    const arg = argAt(given.args, i - given.start);
    if (arg?.parse !== undefined) {
      jobs.push({ arg: arg as Job["arg"], given, index: i });
    }
  }
}

/** The problem with the value of `job`, which its parser rejected for `reason`. */
function rejection({ arg, given, index }: Job, reason: string, context: ErrorContext): ParseError {
  const at = index - given.start;
  const typed = index < given.typedEnd;
  return invalidValue(
    given.values[index] as string,
    targetOf(given.option, given.args, arg, at),
    reason,
    !typed,
    { ...context, token: typed ? given.tokens[at] : undefined, start: typed ? given.tokenStart : undefined },
    describeParser(arg)?.choices,
  );
}

/**
 * What a value of `arg`, the argument at `index` of `args`, is for, as the
 * user would write it: `<name>` for a positional argument, or the option's
 * name, which `option` is otherwise.
 */
function targetOf(option: string | null, args: ArgList, arg: Arg, index: number): string {
  if (option === null) {
    return `<${argName(arg)}>`;
  }
  // An option with several arguments says which one the value is for.
  if (Array.isArray(args) && args.length > 1) {
    return `${option} <${argName(arg, `argument ${index + 1}`)}>`;
  }
  return option;
}

/**
 * Run each argument's parser on the values in `unparsed`, and put what each
 * value parsed to in its place. Resolves to what the defaults of each unused
 * option parsed to. Rejects with every problem together, the ones the
 * command-line parser found and each value its parser rejected.
 */
export async function parseValues({
  context,
  problems,
  given,
  unused,
}: Unparsed): Promise<Map<Option, unknown[]> | null> {
  const jobs: Job[] = [];
  for (const each of given) {
    addJobs(jobs, each);
  }
  let defaults: Map<Option, unknown[]> | null = null;
  for (const option of unused) {
    const values = unusedDefaults(option);
    if (values) {
      (defaults ??= new Map()).set(option, values);
      const name = optionNames(option);
      addJobs(jobs, {
        args: option.args,
        option: name,
        values,
        start: 0,
        typedEnd: 0,
        end: values.length,
        tokens: [],
      });
    }
  }

  const results = await Promise.all(
    jobs.map((job) => apply(job.arg.parse, job.given.values[job.index] as string)),
  );
  // Positional arguments first, then options in the order used, whichever
  // parser settled first.
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const result = results[i];
    if (result instanceof Rejected) {
      (problems ??= []).push(rejection(job, result.reason, context));
    } else {
      job.given.values[job.index] = result;
    }
  }
  if (problems) {
    throw problemsError(problems);
  }
  return defaults;
}
