/**
 * Shell completion.
 *
 * The `completion` subcommand prints a short script for a supported shell. On
 * every Tab, that script runs the CLI's hidden `completion complete` command
 * with the command line typed so far. The CLI then works out the candidates
 * with the parser's own `readNext`, so completion always matches what the parser
 * accepts at that position: subcommands, options with their
 * relationship rules, and argument values from `template`, `suggestions` and
 * `generators`.
 *
 * @module
 */

import type { Arg, Spec, Subcommand, Template } from "./types.js";
import { makeArray, print } from "./util.js";
import { printUsageError } from "./help.js";
import { visibleSubcommands } from "./subcommands.js";
import { readNext } from "./parse.js";
import type { NextToken } from "./parse.js";
import type { Directives } from "./directives.js";

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

/** Enumerate filesystem entries matching `partial` for a path template. */
async function enumeratePaths(partial: string, template: Template): Promise<Candidate[]> {
  // Imported through a variable so the Node-free `src` build doesn't need
  // @types/node; this only runs inside the (Node-only) completion runtime.
  const specifier = "node:fs";
  const { readdirSync } = (await import(specifier)) as {
    readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
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

/** Decide which kinds of candidate the word being completed can use. */
function wantedCandidates(directives: Directives, req: CompletionRequest) {
  const posixNoncompliant = directives.flagsArePosixNoncompliant;
  const partialIsOption = !posixNoncompliant && (req.partial.startsWith("-") || req.partial.startsWith("+"));
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
 * Resolve completion candidates for a partial command line. The parser works
 * out what the word can be with {@link readNext}, and this offers candidates
 * for each of those.
 */
export async function completeRuntime(req: CompletionRequest): Promise<Candidate[]> {
  const next = readNext(req.spec, req.before, req.partial);
  const tokens = [...req.before];

  // The word is an option with a value attached, like `--mode=fa`.
  if (next.attached) {
    const { prefix, arg, value } = next.attached;
    const values = await argValues(arg, tokens, value);
    return values.map((candidate) => ({
      value: prefix + candidate.value,
      description: candidate.description,
    }));
  }

  // The open option needs this word as its value.
  if (next.value?.required) {
    return next.value.arg ? argValues(next.value.arg, tokens, req.partial) : [];
  }

  const candidates: Candidate[] = [];
  const { wantValues, wantOptions } = wantedCandidates(next.scope.directives, req);
  if (wantValues) {
    // While an option can take another value, a word that isn't an option or
    // subcommand is its value instead of an argument.
    const arg = next.value ? next.value.arg : next.arg;
    if (arg) candidates.push(...(await argValues(arg, tokens, req.partial)));
    for (const sub of visibleSubcommands(next.subcommands)) {
      const description = firstLine(sub.description);
      for (const token of makeArray(sub.name)) {
        candidates.push({ value: token, description });
      }
    }
  }
  if (wantOptions && next.optionsAllowed) {
    candidates.push(...optionCandidates(next));
  }
  return candidates;
}

/** The options a user can use next, required ones first. */
function optionCandidates(next: NextToken): Candidate[] {
  const required: Candidate[] = [];
  const optional: Candidate[] = [];
  const { local, persistent } = next.scope.visible();

  for (const { option, names } of [...local, ...persistent]) {
    // The parser lets a later use of an option override an earlier one, but
    // that's rarely what someone wants, so an option that isn't repeatable is
    // offered once.
    if (!option.isRepeatable && next.seenOptions.includes(option)) continue;
    if (next.conflicts(option)) continue;

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
    const sep = next.scope.requiredSeparator(option);

    const bucket = option.isRequired ? required : optional;
    for (const token of names) {
      // The parser reads a name that a subcommand matches as that subcommand.
      if (next.subcommandFor(token)) continue;
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
  action({ path, args: [shell] }) {
    const spec = path[0] as Spec;
    if (shell === undefined) {
      print(`Supported shells: ${SHELLS.join(", ")}`);
      return 0;
    }

    if (!isShell(shell)) {
      printUsageError(path, `Unsupported shell '${shell}'`, { input: shell, choices: SHELLS });
      return 1;
    }

    print(getCompletion(spec, shell));
    return 0;
  },
};
