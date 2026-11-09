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
import { readNext } from "./parse.js";
import type { NextToken } from "./parse.js";

/** Shells that {@link getCompletion} can generate scripts for. */
export type Shell = "bash" | "zsh" | "fish" | "powershell" | "nushell";

export const SHELLS: readonly Shell[] = ["bash", "zsh", "fish", "powershell", "nushell"];

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

/** Single-quote a string for PowerShell (a quote is written twice). */
function psQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * Quote a string for Nushell. A single-quoted string has no escapes, so a name
 * with a quote in it is written as a double-quoted string instead.
 */
function nuQuote(value: string): string {
  if (!value.includes("'")) {
    return `'${value}'`;
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
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
  // Windows paths can use either separator. Elsewhere `\` is part of a name.
  const isWindows = (globalThis as { process?: { platform?: string } }).process?.platform === "win32";
  const slash = Math.max(partial.lastIndexOf("/"), isWindows ? partial.lastIndexOf("\\") : -1);
  const dir = slash >= 0 ? partial.slice(0, slash + 1) : "";
  const base = slash >= 0 ? partial.slice(slash + 1) : partial;
  // A folder ends with the separator the user typed last.
  const separator = slash >= 0 ? partial[slash] : "/";
  const foldersOnly = template === "folders";
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync((isWindows ? dir.replaceAll("\\", "/") : dir) || ".", { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: Candidate[] = [];
  for (const entry of entries as { name: string; isDirectory(): boolean }[]) {
    if (!entry.name.startsWith(base)) {
      continue;
    }
    const isDir = entry.isDirectory();
    if (foldersOnly && !isDir) {
      continue;
    }
    candidates.push({ value: `${dir}${entry.name}${isDir ? separator : ""}` });
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
    if (!generator.custom) {
      continue;
    }
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
function wantedCandidates(next: NextToken, req: CompletionRequest) {
  // Posix-noncompliant options have no dash to gate on, so they're always
  // offered alongside the other candidates.
  if (!req.gateOptions || next.directives.flagsArePosixNoncompliant) {
    return { wantValues: true, wantOptions: true, wantSubcommand: () => true };
  }
  // When gating, a word the parser reads as an option completes no values.
  // Options, and subcommands named like them, are offered once the word starts
  // one of their names.
  const partial = req.partial;
  const wantValues = !next.partialIsOption;
  const starts = (name: string) => partial !== "" && name.startsWith(partial);
  return {
    wantValues,
    wantOptions: next.options.some(({ forms }) => forms.some(({ name }) => starts(name))),
    wantSubcommand: (name: string) => wantValues || starts(name),
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
  const { wantValues, wantOptions, wantSubcommand } = wantedCandidates(next, req);
  if (wantValues) {
    // While an option can take another value, a word that isn't an option or
    // subcommand is its value instead of an argument.
    const arg = next.value ? next.value.arg : next.arg;
    if (arg) {
      candidates.push(...(await argValues(arg, tokens, req.partial)));
    }
  }
  for (const { command, names } of next.subcommands) {
    if (command.hidden) {
      continue;
    }
    const description = firstLine(command.description);
    for (const token of names) {
      if (wantSubcommand(token)) {
        candidates.push({ value: token, description });
      }
    }
  }
  if (wantOptions) {
    candidates.push(...optionCandidates(next));
  }
  return candidates;
}

/** The options a user can use next, required ones first. */
function optionCandidates(next: NextToken): Candidate[] {
  const required: Candidate[] = [];
  const optional: Candidate[] = [];

  for (const { option, forms, used } of next.options) {
    if (option.hidden) {
      continue;
    }
    // The parser lets a later use of an option override an earlier one, but
    // that's rarely what someone wants, so an option that isn't repeatable is
    // offered once.
    if (used && !option.isRepeatable) {
      continue;
    }

    let description = firstLine(option.description);
    if (option.dependsOn) {
      const needs = option.dependsOn.join(", ");
      description = description ? `${description} (requires ${needs})` : `requires ${needs}`;
    }
    if (option.isRequired) {
      description = description ? `${description} [required]` : "[required]";
    }

    // A name joined to its value by a separator is offered with the separator,
    // so the next Tab completes the value. A name joined with nothing between,
    // like `-` in `-5`, is only the option once the value is typed, so it isn't
    // offered.
    const bucket = option.isRequired ? required : optional;
    for (const { name, join } of forms) {
      if (join === "") {
        continue;
      }
      bucket.push({ value: name + (join ?? ""), description });
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
  if (shell === "powershell") {
    // PowerShell doesn't filter or quote a native command's candidates, so the
    // script does both. The arguments go through an array so that PowerShell
    // passes `--` on to the CLI. Windows PowerShell drops an empty argument,
    // so an empty word is passed as --empty-word. The word is passed and
    // matched without the quote it was opened with.
    const stringAst = "[System.Management.Automation.Language.StringConstantExpressionAst]";
    return [
      `Register-ArgumentCompleter -Native -CommandName ${psQuote(name)} -ScriptBlock {`,
      `  param($wordToComplete, $commandAst, $cursorPosition)`,
      `  $elements = $commandAst.CommandElements`,
      `  $first = $elements[0]`,
      `  $bin = if ($first -is ${stringAst}) { $first.Value } else { $first.Extent.Text }`,
      `  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { return }`,
      `  $partial = $wordToComplete`,
      `  if ($partial.StartsWith("'")) { $partial = $partial.Substring(1).TrimEnd("'").Replace("''", "'") }`,
      `  elseif ($partial.StartsWith('"')) { $partial = $partial.Substring(1).TrimEnd('"') }`,
      `  $arguments = @('completion', 'complete', '--gate-options')`,
      `  if ($partial -eq '') { $arguments += '--empty-word' }`,
      `  $arguments += '--'`,
      `  for ($i = 1; $i -lt $elements.Count; $i++) {`,
      `    $element = $elements[$i]`,
      `    if ($element.Extent.EndOffset -ge $cursorPosition) { break }`,
      `    if ($element -is ${stringAst}) {`,
      `      $arguments += $element.Value`,
      `    } else {`,
      `      $arguments += $element.Extent.Text`,
      `    }`,
      `  }`,
      `  if ($partial -ne '') { $arguments += $partial }`,
      `  & $bin @arguments 2>$null | ForEach-Object {`,
      '    $value, $description = $_ -split "`t", 2',
      `    if (-not $value.StartsWith($partial, [System.StringComparison]::OrdinalIgnoreCase)) { return }`,
      "    $text = if ($value -match '[\\s''\"`$&|;,(){}<>@#]') { \"'$($value.Replace(\"'\", \"''\"))'\" } else { $value }",
      `    if (-not $description) { $description = $value }`,
      `    [System.Management.Automation.CompletionResult]::new($text, $value, 'ParameterValue', $description)`,
      `  }`,
      `}`,
    ].join("\n");
  }
  if (shell === "nushell") {
    // Nushell has one completer for every external command, so the script
    // keeps the completer that was set before and hands it other commands.
    // The spans keep the quotes they were typed with, the command's included,
    // so the script removes them. A command on Windows can be typed with its
    // extension. Nushell doesn't filter or quote what an external completer
    // returns, so the script does both.
    const previous = `$__${id}_previous_completer`;
    const names = ["", ".exe", ".cmd", ".bat"].map((extension) => nuQuote(name + extension)).join(" ");
    return [
      `let __${id}_previous_completer = $env.config.completions.external.completer?`,
      `$env.config.completions.external.completer = {|spans|`,
      `  let words = $spans | each {|span|`,
      `    let quote = $span | str substring 0..0`,
      `    if $quote in ["'", '"', '\`'] { $span | str substring 1.. | str trim --right --char $quote } else { $span }`,
      `  }`,
      `  let command = $words.0`,
      `  if ($command | path basename) not-in [${names}] {`,
      `    return (if ${previous} != null { do ${previous} $spans })`,
      `  }`,
      `  if (which $command | is-empty) { return }`,
      `  let args = $words | skip 1`,
      `  let partial = $args | last | default ""`,
      `  ^$command completion complete --gate-options -- ...$args`,
      `    | complete`,
      `    | get stdout`,
      `    | lines`,
      `    | each {|line|`,
      `      let parts = $line | split row "\\t"`,
      `      { value: $parts.0, description: ($parts | get 1? | default "") }`,
      `    }`,
      `    | where { $in.value | str starts-with --ignore-case $partial }`,
      "    | update value {|candidate|",
      "      let value = $candidate.value",
      '      if ($value !~ "[\\\\s\'\\"`$|;#()\\\\[\\\\]{}]") {',
      "        $value",
      '      } else if ($value | str contains "\'") {',
      "        $value | to json",
      "      } else {",
      "        $\"'($value)'\"",
      "      }",
      "    }",
      `}`,
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
    {
      name: "--empty-word",
      description: "The word being completed is empty, so every token is before it",
    },
  ],
  args: { name: "tokens", isVariadic: true, isOptional: true },
  async action({ path, args, options }) {
    const spec = path[0] as Spec;
    // Windows PowerShell drops an empty argument, so its script says the word
    // is empty with --empty-word instead of passing "".
    const emptyWord = options.has("--empty-word");
    const partial = emptyWord || args.length === 0 ? "" : args[args.length - 1];
    const before = emptyWord ? args : args.slice(0, -1);
    const candidates = await completeRuntime({
      spec,
      before,
      partial,
      gateOptions: options.has("--gate-options"),
    });
    const lines = candidates.map((candidate) =>
      candidate.description ? `${candidate.value}\t${candidate.description}` : candidate.value,
    );
    if (lines.length > 0) {
      print(lines.join("\n"));
    }
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
    description: `One of: ${SHELLS.join(", ")}`,
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
