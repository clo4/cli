/**
 * Shell completion.
 *
 * The `completion` subcommand prints a short script for a supported shell. On
 * every Tab, that script runs the CLI's hidden `completion complete` command
 * with the command line typed so far. The CLI then works out the candidates
 * with the same `analyze` the parser uses, so completion always matches what
 * the parser accepts at that position: subcommands, options with their
 * relationship rules, and argument values from `template`, `suggestions` and
 * `generators`.
 *
 * @module
 */

import type { Arg, Option, Spec, Subcommand, Template } from "./types.js";
import { asArray, makeArray, print, printActionError } from "./util.js";
import { analyze } from "./analyze.js";

/** Shells that {@link getCompletion} can generate scripts for. */
export type Shell = "bash" | "zsh" | "fish";

export const SHELLS: readonly Shell[] = ["bash", "zsh", "fish"];

function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

const firstLine = (description: string | undefined): string =>
  description ? description.split("\n", 1)[0].trim() : "";

/** Turn an arbitrary name into a safe shell identifier fragment. */
const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, "_");

/** Single-quote a string for bash/zsh. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Single-quote a string for fish (only `\` and `'` are special). */
function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

// Runtime resolver {{{

/** A single completion candidate. */
interface Candidate {
  value: string;
  description?: string;
}

/**
 * The completion-relevant state of a partial command line, derived by reusing
 * `analyze` (which already handles `--`, separators, prefix-matching, and
 * posix-noncompliance) plus a small non-throwing pass for option-arg consumption
 * and positional counting.
 */
interface CompletionState {
  /** Commands from the root to the current one. */
  path: Subcommand[];
  current: Subcommand;
  /** Options usable at the current command (own + inherited persistent). */
  availableOptions: Option[];
  /** A option still expecting a separate-token value, or null. */
  pending: { option: Option; argIndex: number } | null;
  /** Positional args already consumed by the current command. */
  positionalIndex: number;
  /** Option names already present on the line. */
  presentNames: Set<string>;
  /** Times each option object has appeared. */
  countByOption: Map<Option, number>;
  /** A `--` separator was seen; only positionals follow. */
  forceArgs: boolean;
  /** A positional has been consumed by the current command. */
  sawPositional: boolean;
}

function analyzeState(spec: Spec, before: readonly string[]): CompletionState {
  const { tokens, finalState } = analyze<Subcommand, Option>(before, spec);

  const path: Subcommand[] = [spec as unknown as Subcommand];
  let current: Subcommand = spec as unknown as Subcommand;
  let positionalIndex = 0;
  let forceArgs = false;
  let sawPositional = false;
  const presentNames = new Set<string>();
  const countByOption = new Map<Option, number>();

  for (const token of tokens) {
    switch (token.kind) {
      case "subcommand": {
        current = token.subcommand;
        path.push(current);
        positionalIndex = 0;
        sawPositional = false;
        break;
      }
      case "option": {
        const option = token.option;
        for (const name of makeArray(option.name)) presentNames.add(name);
        countByOption.set(option, (countByOption.get(option) ?? 0) + 1);
        break;
      }
      case "arg": {
        positionalIndex += 1;
        sawPositional = true;
        break;
      }
      case "arg-separator": {
        forceArgs = true;
        break;
      }
    }
  }

  const open = finalState.openOption;
  const pending = open ? { option: open.option, argIndex: open.valueCount } : null;

  // An option is available if one of its names still refers to it: a later
  // option with the same name shadows an earlier one.
  const availableOptions: Option[] = [];
  const seen = new Set<Option>();
  for (const list of [finalState.localOptions, finalState.persistentOptions]) {
    const byName = new Map<string, Option>();
    for (const option of list) {
      for (const name of makeArray(option.name)) byName.set(name, option);
    }
    for (const option of byName.values()) {
      if (!seen.has(option)) {
        seen.add(option);
        availableOptions.push(option);
      }
    }
  }

  return {
    path,
    current,
    availableOptions,
    pending,
    positionalIndex,
    presentNames,
    countByOption,
    forceArgs,
    sawPositional,
  };
}

/** Does any command on the path enable a sticky parser directive? */
function directiveOnPath(
  path: readonly Subcommand[],
  key: "optionsMustPrecedeArguments" | "flagsArePosixNoncompliant",
): boolean {
  return path.some((command) => command.parserDirectives?.[key]);
}

/** The option-arg separators in effect (the deepest command that sets them). */
function separatorsOnPath(path: readonly Subcommand[]): string[] {
  let separators = ["="];
  for (const command of path) {
    const configured = command.parserDirectives?.optionArgSeparators;
    if (configured) separators = makeArray(configured);
  }
  return separators;
}

/** Enumerate filesystem entries matching `partial` for a path template. */
async function enumeratePaths(partial: string, template: Template): Promise<Candidate[]> {
  // Imported through a variable so the Node-free `src` build doesn't need
  // @types/node; this only runs inside the (Node-only) completion runtime.
  const specifier = "node:fs";
  const { readdirSync } = (await import(specifier)) as {
    readdirSync(
      path: string,
      options: { withFileTypes: true },
    ): { name: string; isDirectory(): boolean }[];
  };
  const slash = partial.lastIndexOf("/");
  const dir = slash >= 0 ? partial.slice(0, slash + 1) : "";
  const base = slash >= 0 ? partial.slice(slash + 1) : partial;
  const foldersOnly = template === "folders";
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(dir || ".", { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: Candidate[] = [];
  for (const entry of entries as { name: string; isDirectory(): boolean }[]) {
    if (!entry.name.startsWith(base)) continue;
    const isDir = entry.isDirectory();
    if (foldersOnly && !isDir) continue;
    candidates.push({ value: `${dir}${entry.name}${isDir ? "/" : ""}` });
  }
  return candidates;
}

/** All candidate values for a single argument (suggestions/generators/template). */
async function argValues(arg: Arg, tokens: string[], partial: string): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (const suggestion of arg.suggestions ?? []) {
    candidates.push(
      typeof suggestion === "string"
        ? { value: suggestion }
        : { value: makeArray(suggestion.name)[0], description: suggestion.description },
    );
  }

  for (const generator of makeArray(arg.generators)) {
    if (!generator.custom) continue;
    const produced = await generator.custom([...tokens, partial]);
    for (const suggestion of produced) {
      candidates.push(
        typeof suggestion === "string"
          ? { value: suggestion }
          : { value: makeArray(suggestion.name)[0], description: suggestion.description },
      );
    }
  }

  if (arg.template) {
    candidates.push(...(await enumeratePaths(partial, arg.template)));
  }

  return candidates;
}

/** Pick the argument at an index, reusing a final variadic argument. */
function argAt(args: readonly Arg[], index: number): Arg | undefined {
  if (args.length === 0) return undefined;
  if (index < args.length) return args[index];
  const last = args[args.length - 1];
  return last?.isVariadic ? last : undefined;
}

/** Pick the argument being completed at a positional index (honors variadic). */
function positionalArg(command: Subcommand, index: number): Arg | undefined {
  return argAt(asArray(command.args) as readonly Arg[], index);
}

/** Decide which kinds of candidate the word being completed can use. */
function wantedCandidates(state: CompletionState, req: CompletionRequest) {
  const posixNoncompliant = directiveOnPath(state.path, "flagsArePosixNoncompliant");
  const partialIsOption =
    !posixNoncompliant && (req.partial.startsWith("-") || req.partial.startsWith("+"));
  // When gating, a dashed word completes options only; everything else completes
  // commands/positionals. Posix-noncompliant options have no dash, so they're
  // exempt and always offered alongside the other candidates.
  return {
    wantValues: !(req.gateOptions && partialIsOption),
    wantOptions: !req.gateOptions || partialIsOption || posixNoncompliant,
  };
}

/** Inputs for the runtime completion resolver. */
export interface CompletionRequest {
  spec: Spec;
  /** Tokens after the program name, excluding the word being completed. */
  before: readonly string[];
  /** The word being completed. */
  partial: string;
  /** Only offer options once the word being completed starts with a dash. */
  gateOptions?: boolean;
}

/**
 * Resolve completion candidates for a partial command line, reusing the parser
 * (`analyze`) for context. Dispatches between completing a option's value and
 * completing a fresh token (subcommand / positional / option).
 */
export async function completeRuntime(req: CompletionRequest): Promise<Candidate[]> {
  const state = analyzeState(req.spec, req.before);
  const separators = separatorsOnPath(state.path);

  const optionValue = await resolveOptionValue(state, req, separators);
  if (optionValue) return optionValue;

  return freshTokenCandidates(state, req, separators);
}

/**
 * Candidates when the word being completed is a option's value — either attached
 * (`--option=value`) or the separate token after a option that expects one. Returns
 * null when no option value is being completed.
 */
async function resolveOptionValue(
  state: CompletionState,
  req: CompletionRequest,
  separators: string[],
): Promise<Candidate[] | null> {
  const tokens = [...req.before];

  // `--option<sep>value`: the partial already carries a separator.
  for (const separator of separators) {
    const at = req.partial.indexOf(separator);
    if (at <= 0) continue;
    const optionName = req.partial.slice(0, at);
    const option = state.availableOptions.find((candidate) =>
      makeArray(candidate.name).includes(optionName),
    );
    const arg = option && (asArray(option.args) as Arg[])[0];
    if (option && arg) {
      const valuePrefix = req.partial.slice(at + separator.length);
      const values = await argValues(arg, tokens, valuePrefix);
      return values.map((candidate) => ({
        value: `${optionName}${separator}${candidate.value}`,
        description: candidate.description,
      }));
    }
  }

  // The separate-token value of a option that expects one.
  if (state.pending) {
    const { option, argIndex } = state.pending;
    const args = asArray(option.args) as readonly Arg[];
    const arg = argAt(args, argIndex);
    if (argIndex < args.length) {
      return arg ? argValues(arg, tokens, req.partial) : [];
    }
    // Past its declared args, a variadic option takes another value or gives
    // way to the next option.
    const { wantValues, wantOptions } = wantedCandidates(state, req);
    return [
      ...(arg && wantValues ? await argValues(arg, tokens, req.partial) : []),
      ...(wantOptions ? allowedOptionCandidates(state, separators) : []),
    ];
  }

  return null;
}

/** Candidates when completing a fresh token: subcommand / positional / option. */
async function freshTokenCandidates(
  state: CompletionState,
  req: CompletionRequest,
  separators: string[],
): Promise<Candidate[]> {
  const candidates: Candidate[] = [];
  const tokens = [...req.before];

  const { wantValues, wantOptions } = wantedCandidates(state, req);

  if (wantValues) {
    const positional = positionalArg(state.current, state.positionalIndex);
    if (positional) {
      candidates.push(...(await argValues(positional, tokens, req.partial)));
    }
    // After `--`, only positionals are valid.
    if (state.forceArgs) return candidates;

    // Subcommands — only while the parser would still match one.
    if (!state.sawPositional) {
      for (const sub of state.current.subcommands ?? []) {
        if (sub.hidden) continue;
        const description = firstLine(sub.description);
        for (const token of makeArray(sub.name)) {
          candidates.push({ value: token, description });
        }
      }
    }
  } else if (state.forceArgs) {
    // A dashed token after `--` is a literal argument, not a option.
    return candidates;
  }

  if (wantOptions) {
    candidates.push(...allowedOptionCandidates(state, separators));
  }

  return candidates;
}

/** Option candidates, unless options must precede arguments and one was seen. */
function allowedOptionCandidates(state: CompletionState, separators: string[]): Candidate[] {
  const optionsBlocked =
    state.sawPositional && directiveOnPath(state.path, "optionsMustPrecedeArguments");
  return optionsBlocked ? [] : optionCandidates(state, separators);
}

/** Eligible option candidates after relationship filtering. */
function optionCandidates(state: CompletionState, separators: string[]): Candidate[] {
  const required: Candidate[] = [];
  const optional: Candidate[] = [];

  for (const option of state.availableOptions) {
    if (option.hidden) continue;

    // Repeatable limits: drop a option that can't appear again.
    const count = state.countByOption.get(option) ?? 0;
    if (count > 0) {
      if (!option.isRepeatable) continue;
      if (typeof option.isRepeatable === "number" && count >= option.isRepeatable) {
        continue;
      }
    }

    // Mutual exclusion, both directions.
    if (option.exclusiveOn?.some((name) => state.presentNames.has(name))) continue;
    const conflicts = state.availableOptions.some(
      (other) =>
        other !== option &&
        makeArray(other.name).some((name) => state.presentNames.has(name)) &&
        other.exclusiveOn?.some((name) => makeArray(option.name).includes(name)),
    );
    if (conflicts) continue;

    let description = firstLine(option.description);
    if (option.dependsOn) {
      const needs = option.dependsOn.join(", ");
      description = description ? `${description} (requires ${needs})` : `requires ${needs}`;
    }
    if (option.isRequired) {
      description = description ? `${description} [required]` : "[required]";
    }

    // requiresSeparator options can only take an attached value, so offer the
    // separator form so the next Tab completes the value.
    const sep =
      option.requiresSeparator === true
        ? separators[0]
        : typeof option.requiresSeparator === "string"
          ? option.requiresSeparator
          : undefined;

    const bucket = option.isRequired ? required : optional;
    for (const token of makeArray(option.name)) {
      bucket.push({ value: sep ? `${token}${sep}` : token, description });
    }
  }

  return [...required, ...optional];
}

/**
 * Render the thin shim that forwards the line to `completion complete`. The
 * binary is invoked as typed (so `./pack` works) and guarded so a missing
 * command degrades to no completion instead of an error.
 */
function renderRuntimeShim(spec: Spec, shell: Shell): string {
  const id = sanitize(spec.name);
  const name = spec.name;
  if (shell === "bash") {
    return [
      `_${id}_complete() {`,
      `  local bin="\${COMP_WORDS[0]}"`,
      `  command -v "$bin" >/dev/null 2>&1 || return`,
      `  local cur="\${COMP_WORDS[COMP_CWORD]}"`,
      `  local out`,
      `  out="$("$bin" completion complete --gate-options -- "\${COMP_WORDS[@]:1:COMP_CWORD-1}" "$cur" 2>/dev/null | cut -f1)"`,
      `  local IFS=$'\\n'`,
      `  COMPREPLY=( $(compgen -W "$out" -- "$cur") )`,
      `}`,
      `complete -F _${id}_complete ${shQuote(name)}`,
    ].join("\n");
  }
  if (shell === "zsh") {
    return [
      `#compdef ${name}`,
      `_${id}_complete() {`,
      `  local bin="$words[1]"`,
      `  command -v "$bin" >/dev/null 2>&1 || return`,
      `  local -a lines`,
      `  lines=( "\${(@f)$("$bin" completion complete -- "\${words[2,CURRENT-1]}" "\${words[CURRENT]}" 2>/dev/null)}" )`,
      `  local -a disp`,
      `  local line`,
      `  for line in $lines; do disp+=( "\${line//$'\\t'/:}" ); done`,
      `  _describe -t values ${shQuote(name)} disp`,
      `}`,
      `_${id}_complete "$@"`,
    ].join("\n");
  }
  // fish
  return [
    `function __${id}_complete`,
    `  set -l toks (commandline -opc)`,
    `  set -l cur (commandline -ct)`,
    `  set -l bin $toks[1]`,
    `  command -q -- $bin; or test -x "$bin"; or return`,
    `  $bin completion complete --gate-options -- $toks[2..-1] $cur 2>/dev/null`,
    `end`,
    `complete -c ${fishQuote(name)} -f -a '(__${id}_complete)'`,
  ].join("\n");
}

// }}}

/** Generate a completion script for `shell` from a CLI spec. */
export function getCompletion(spec: Spec, shell: Shell): string {
  return renderRuntimeShim(spec, shell);
}

// Completion commands {{{

/**
 * Hidden machine-facing subcommand the `--runtime` shim calls on every Tab.
 * The tokens after `--` are the command line; the last is the word being
 * completed. Prints `value\tdescription` lines.
 */
const completeCommand: Subcommand = {
  name: "complete",
  description: "Resolve completion candidates for a partial command line",
  hidden: true,
  options: [
    {
      name: "--gate-options",
      description: "Only suggest options after a leading dash",
    },
  ],
  args: { name: "tokens", isVariadic: true, isOptional: true },
  async action({ path, args, options }) {
    const spec = path[0] as Spec;
    const partial = args.length > 0 ? args[args.length - 1] : "";
    const before = args.slice(0, -1);
    const candidates = await completeRuntime({
      spec,
      before,
      partial,
      gateOptions: options.has("--gate-options"),
    });
    const lines = candidates.map((candidate) =>
      candidate.description ? `${candidate.value}\t${candidate.description}` : candidate.value,
    );
    if (lines.length > 0) print(lines.join("\n"));
    return 0;
  },
};

// }}}

/** A subcommand that prints a shell completion script for the whole CLI. */
export const completion: Subcommand = {
  name: "completion",
  description: "Print a shell completion script",
  args: {
    name: "shell",
    isOptional: true,
    suggestions: SHELLS,
  },
  subcommands: [completeCommand],
  action({ path: [spec], args: [shell], help }) {
    if (shell === undefined) {
      print(`Supported shells: ${SHELLS.join(", ")}`);
      return 0;
    }

    if (!isShell(shell)) {
      printActionError(
        `Unsupported shell '${shell}'\n\n${help({
          description: false,
          didYouMean: { input: shell, choices: SHELLS as string[] },
        })}`,
      );
      return 1;
    }

    print(getCompletion(spec, shell));
    return 0;
  },
};
