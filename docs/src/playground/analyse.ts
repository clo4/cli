import * as CLI from "@clo4/cli";
import type { Spec, Subcommand } from "@clo4/cli";
import { ParseError, parse, tokenReader } from "@clo4/cli/unstable";
import type { Piece } from "./tree";
import { asArray } from "./util";
import { words, type Word } from "./words";

/** What the parser reads a word as. */
export type Kind =
  | "program"
  | "subcommand"
  | "option"
  | "value"
  | "argument"
  | "separator"
  | "unknown"
  | "unread";

export interface Problem {
  message: string;
  /** The index of the word it's about. */
  token?: number;
  /** Where in that word the problem starts, if not at its start. */
  start?: number;
}

export interface Token extends Word {
  kind: Kind;
  /** The pieces of the spec the word is. A word of short options is each of them. */
  pieces: Piece[];
  problems: Problem[];
}

/** A line the command printed, to standard output or error. */
export interface Printed {
  fd: 1 | 2;
  text: string;
}

export type ParseResult = Awaited<ReturnType<typeof parse>>;

export interface Analysis {
  tokens: Token[];
  problems: Problem[];
  /** What the action gets, if the line parses. */
  result: ParseResult | null;
  printed: Printed[];
}

/**
 * How `spec` reads `line`: what each word is, what's wrong with it, what the
 * action gets, and what running it prints. The first word is the program.
 */
export async function analyse(
  spec: Spec,
  line: string,
  notFound: (name: string) => string,
): Promise<Analysis> {
  const tokens: Token[] = words(line).map((word) => ({ ...word, kind: "unread", pieces: [], problems: [] }));
  const problems: Problem[] = [];
  const report = (problem: Problem) => {
    problems.push(problem);
    if (problem.token !== undefined) {
      tokens[problem.token].problems.push(problem);
    }
  };
  if (tokens.length === 0) {
    return { tokens, problems, result: null, printed: [] };
  }

  const [program, ...rest] = tokens;
  program.kind = "program";
  if (program.text !== spec.name) {
    report({ message: notFound(program.text), token: 0 });
    return { tokens, problems, result: null, printed: [{ fd: 2, text: `${problems[0].message}\n` }] };
  }
  program.pieces = [spec];

  const reader = tokenReader(spec);
  let command: Spec | Subcommand = spec;
  let positional = 0;
  for (const token of rest) {
    const reading = await reader.read(token.text);
    token.kind = reading.kind === "options" ? "option" : reading.kind;
    if (reading.kind === "subcommand") {
      command = reading.command;
      positional = 0;
      token.pieces = [reading.command];
    } else if (reading.kind === "options") {
      token.pieces = [...reading.options];
    } else if (reading.kind === "value") {
      token.pieces = [reading.option, ...asArray(reading.option.args)];
    } else if (reading.kind === "argument") {
      const args = asArray(command.args);
      const arg = args[Math.min(positional++, args.length - 1)];
      if (arg) {
        token.pieces = [arg];
      }
    }
  }

  const argv = rest.map((token) => token.text);
  let result: ParseResult | null = null;
  try {
    result = await parse(argv, spec);
  } catch (error) {
    if (!(error instanceof ParseError)) {
      throw error;
    }
    for (const problem of error.problems ?? [error]) {
      const at = problem.context.token;
      report({
        message: problem.message,
        token: at === undefined ? undefined : at + 1,
        start: problem.context.start,
      });
    }
  }
  return { tokens, problems, result, printed: await execute(spec, argv) };
}

/** What running `spec` with `argv` prints. */
async function execute(spec: Spec, argv: string[]): Promise<Printed[]> {
  const printed: Printed[] = [];
  const write =
    (fd: 1 | 2) =>
    (...values: unknown[]) =>
      printed.push({ fd, text: `${values.map(String).join(" ")}\n` });
  const { log, error } = console;
  console.log = write(1);
  console.error = write(2);
  try {
    await CLI.run(spec, { argv, setExitCode: false });
  } finally {
    console.log = log;
    console.error = error;
  }
  return printed;
}
