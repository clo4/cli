/**
 * Shell completion.
 *
 * The `completion` subcommand prints a short script for a supported shell. On
 * every Tab, that script runs the CLI's hidden `completion complete` command
 * with the command line typed so far. The CLI then works out the candidates
 * with the parser's own `readNextOrWait`, so completion always matches what the parser
 * accepts at that position: subcommands, options with their
 * relationship rules, and argument values from `template`, `suggestions` and
 * `generators`.
 *
 * @module
 */

import type { Arg, Spec, Subcommand, Template } from "./types.js";
import { accepts, choice, choicesOf, completionsOf, isParser } from "./schemas.js";
import { makeArray, output, print } from "./util.js";
import { nextHelpNames } from "./help.js";
import { readNextOrWait } from "./parse.js";
import { formStart } from "./scope.js";
import type { NextToken } from "./parse.js";

export const SHELLS = ["bash", "zsh", "fish", "powershell", "nushell"] as const;

/** Shells supported by the built-in `completion` subcommand. */
export type Shell = (typeof SHELLS)[number];

/** Accepts a supported shell. Help lists the shells and completion offers them. */
const shellSchema = choice(...SHELLS);

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

/**
 * Single-quote a string for PowerShell. A quote is written twice, and
 * PowerShell reads the curly single quotes as quotes too.
 */
function psQuote(value: string): string {
  return `'${value.replace(/['\u2018-\u201b]/g, "$&$&")}'`;
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
  /** The value needs more text after it, like `1920x`, so the shell adds no space. */
  open?: boolean;
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

  // An argument that says nothing about completion offers what its parser
  // accepts. A built-in parser gives what the word could become, and
  // another schema gives the values it lists.
  if (
    arg.parse !== undefined &&
    arg.suggestions === undefined &&
    arg.generators === undefined &&
    arg.template === undefined
  ) {
    const parser = arg.parse;
    if (isParser(parser)) {
      for (const value of completionsOf(parser, partial)) {
        candidates.push(accepts(parser, value) ? { value } : { value, open: true });
      }
    } else {
      for (const value of choicesOf(arg) ?? []) {
        candidates.push({ value });
      }
    }
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
 * out what the word can be with {@link readNextOrWait}, and this offers candidates
 * for each of those.
 */
export async function completeRuntime(req: CompletionRequest): Promise<Candidate[]> {
  const next = await readNextOrWait(req.spec, req.before, req.partial);
  const tokens = [...req.before];

  // The word is an option with a value attached, like `--mode=fa`.
  if (next.attached) {
    const { prefix, arg, value } = next.attached;
    const values = await argValues(arg, tokens, value);
    return values.map((candidate) => ({ ...candidate, value: prefix + candidate.value }));
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
    if (!next.value) {
      candidates.push(...(await helpNameCandidates(next)));
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

/** The names a help command can take next, if the word is an argument of one. */
async function helpNameCandidates(next: NextToken): Promise<Candidate[]> {
  // The parser reads a name of one of these as that subcommand, so help never
  // sees it, and the subcommand loop offers it.
  const taken = new Set(next.subcommands.flatMap(({ names }) => names));
  const candidates: Candidate[] = [];
  for (const { command: subcommand, names } of await nextHelpNames(next.path, next.args)) {
    if (subcommand.hidden) {
      continue;
    }
    const description = firstLine(subcommand.description);
    for (const name of names) {
      if (!taken.has(name)) {
        candidates.push({ value: name, description });
      }
    }
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
    for (const form of forms) {
      if (form.join !== "") {
        bucket.push({ value: formStart(form), description });
      }
    }
  }

  return [...required, ...optional];
}

// }}}

// Candidate lines {{{

/**
 * Format candidates as the lines a shell's completion script reads, one line
 * per candidate. `word` is the word being completed, as the script passed it.
 *
 * - bash: the quoted value, then a space unless the value is open. Bash
 *   inserts a candidate as written and doesn't filter, so this keeps the
 *   values whose quoted form starts with the word.
 * - zsh: `value:description` for `_describe`, with `\` and `:` escaped in the
 *   value, then a tab if the value is open. Zsh filters and quotes the
 *   values itself.
 * - fish: `value<Tab>description`. Fish filters and quotes the values itself.
 * - powershell: `text<Tab>value<Tab>tooltip`, the arguments of a
 *   CompletionResult. Only values that start with the word, ignoring case.
 * - nushell: `text<Tab>description`. Only values that start with the word,
 *   ignoring case.
 *
 * A value with a tab or line break doesn't fit on a line, so it's left out.
 * A description's tabs and line breaks become spaces.
 */
export function formatCandidates(candidates: readonly Candidate[], shell: Shell, word: string): string[] {
  const lines: string[] = [];
  const lowerWord = word.toLowerCase();
  const startsWithWord = (value: string) => value.slice(0, word.length).toLowerCase() === lowerWord;
  for (const candidate of candidates) {
    const value = candidate.value;
    if (value === "" || /[\t\n\r]/.test(value)) {
      continue;
    }
    const description = candidate.description?.replace(/\s*[\t\n\r]\s*/g, " ").trim() ?? "";
    if (shell === "bash") {
      const text = value.replace(/[ '"\\$`|&;()<>{}*?[!#~]/g, "\\$&");
      if (text.startsWith(word)) {
        lines.push(candidate.open ? text : `${text} `);
      }
    } else if (shell === "zsh") {
      // `_describe` splits at the first colon without a backslash before it,
      // then removes the backslashes from both parts.
      const text = value.replace(/[\\:]/g, "\\$&");
      const line = description ? `${text}:${description.replaceAll("\\", "\\\\")}` : text;
      lines.push(candidate.open ? `${line}\t` : line);
    } else if (shell === "fish") {
      lines.push(description ? `${value}\t${description}` : value);
    } else if (startsWithWord(value)) {
      if (shell === "powershell") {
        // A CompletionResult needs a tooltip, so the value stands in for a
        // missing description.
        const text = /[\s'"`$&|;,(){}<>@#\u2018-\u201e]/.test(value) ? psQuote(value) : value;
        lines.push(`${text}\t${value}\t${description || value}`);
      } else {
        const text = /[\s'"`$|;#()[\]{}]/.test(value) ? nuQuote(value) : value;
        lines.push(description ? `${text}\t${description}` : text);
      }
    }
  }
  return lines;
}

// }}}

// Completion scripts {{{

/**
 * Render the thin shim that forwards the line to `completion complete`. The
 * binary is invoked as typed (so `./pack` works) and guarded so a missing
 * command degrades to no completion instead of an error. Each shim passes
 * `--shell`, so the CLI prints lines ready for that shell.
 */
function renderRuntimeShim(spec: Spec, shell: Shell): string {
  const id = sanitize(spec.name);
  const name = spec.name;
  if (shell === "bash") {
    // Each line is one reply. Reading the lines into the array keeps them as
    // written. compgen -W would run the expansions in them, such as $(...).
    //
    // Bash divides a word at each = and :, so the loop joins the pieces that
    // have no space between them back into the word as it was typed. Bash
    // only replaces the last piece, so each reply leaves out the pieces
    // before it. Bash 3 keeps the word whole, and still only replaces the
    // text after its last = or :.
    //
    // A reply ends with its own space, and nospace stops bash adding one
    // after a value that needs more text.
    return `_${id}_complete() {
  local bin="\${COMP_WORDS[0]}"
  command -v "$bin" >/dev/null 2>&1 || return
  local -a words=()
  local rest="$COMP_LINE" piece last="" before="" line i joined
  for ((i = 0; i <= COMP_CWORD; i++)); do
    piece="\${COMP_WORDS[i]}"
    joined=0
    if [[ $i -gt 0 && $rest != [[:space:]]* ]] && [[ $piece =~ ^[=:]+$ || $last =~ ^[=:]+$ ]]; then joined=1; fi
    rest="\${rest#"\${rest%%[![:space:]]*}"}"
    rest="\${rest#"$piece"}"
    if [[ $joined -eq 1 ]]; then
      before="\${words[\${#words[@]}-1]}"
      words[\${#words[@]}-1]="$before$piece"
    else
      before=""
      words[\${#words[@]}]="$piece"
    fi
    last="$piece"
  done
  if [[ $last =~ ^[=:]+$ ]]; then before="\${words[\${#words[@]}-1]}"; fi
  if [[ \${BASH_VERSINFO[0]} -lt 4 && $last != [\\"\\']* ]]; then
    piece=""
    if [[ $COMP_WORDBREAKS == *=* ]]; then piece="$piece="; fi
    if [[ $COMP_WORDBREAKS == *:* ]]; then piece="$piece:"; fi
    if [[ -n $piece && $last == *[$piece]* ]]; then before="\${last%"\${last##*[$piece]}"}"; fi
  fi
  COMPREPLY=()
  while IFS= read -r line; do COMPREPLY+=( "\${line#"$before"}" ); done < <(SHELL_COMPLETION_GENERATOR=bash "$bin" completion complete --shell bash --gate-options -- "\${words[@]:1}" 2>/dev/null)
}
complete -o nospace -F _${id}_complete ${shQuote(name)}`;
  }
  if (shell === "zsh") {
    // The CLI gets the words without their quotes. Zsh leaves the quote that
    // opens the word being completed out of $PREFIX, and (Q) removes the rest.
    // A line that ends with a tab is a value that needs more text, and -S ''
    // stops zsh adding a space after it.
    return `#compdef ${name}
_${id}_complete() {
  local bin="\${(Q)words[1]}"
  command -v "$bin" >/dev/null 2>&1 || return
  local -a lines open
  local line
  for line in \${(f)"$(SHELL_COMPLETION_GENERATOR=zsh "$bin" completion complete --shell zsh -- "\${(@Q)words[2,CURRENT-1]}" "\${(Q)PREFIX}\${(Q)SUFFIX}" 2>/dev/null)"}; do
    if [[ $line == *$'\\t' ]]; then open+=( "\${line%$'\\t'}" ); else lines+=( "$line" ); fi
  done
  _describe -t values ${shQuote(name)} lines -- open -S ''
}
_${id}_complete "$@"`;
  }
  if (shell === "powershell") {
    // The arguments go through an array so that PowerShell passes `--` on to
    // the CLI. Windows PowerShell drops an empty argument, so an empty word is
    // passed as --empty-word. The word is passed without the quote it was
    // opened with.
    const stringAst = "[System.Management.Automation.Language.StringConstantExpressionAst]";
    return `Register-ArgumentCompleter -Native -CommandName ${psQuote(name)} -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $elements = $commandAst.CommandElements
  $first = $elements[0]
  $bin = if ($first -is ${stringAst}) { $first.Value } else { $first.Extent.Text }
  if (-not (Get-Command $bin -ErrorAction SilentlyContinue)) { return }
  $partial = $wordToComplete
  if ($partial.StartsWith("'")) { $partial = $partial.Substring(1).TrimEnd("'").Replace("''", "'") }
  elseif ($partial.StartsWith('"')) { $partial = $partial.Substring(1).TrimEnd('"') }
  $arguments = @('completion', 'complete', '--shell', 'powershell', '--gate-options')
  if ($partial -eq '') { $arguments += '--empty-word' }
  $arguments += '--'
  for ($i = 1; $i -lt $elements.Count; $i++) {
    $element = $elements[$i]
    if ($element.Extent.EndOffset -ge $cursorPosition) { break }
    if ($element -is ${stringAst}) {
      $arguments += $element.Value
    } else {
      $arguments += $element.Extent.Text
    }
  }
  if ($partial -ne '') { $arguments += $partial }
  $previous = $env:SHELL_COMPLETION_GENERATOR
  $env:SHELL_COMPLETION_GENERATOR = 'powershell'
  try {
    $lines = & $bin @arguments 2>$null
  } finally {
    $env:SHELL_COMPLETION_GENERATOR = $previous
  }
  foreach ($line in $lines) {
    $text, $value, $tooltip = $line -split "\`t", 3
    [System.Management.Automation.CompletionResult]::new($text, $value, 'ParameterValue', $tooltip)
  }
}`;
  }
  if (shell === "nushell") {
    // Nushell has one completer for every external command, so the script
    // keeps the completer that was set before and hands it other commands.
    // The spans keep the quotes they were typed with, the command's included,
    // so the script removes them. A command on Windows can be typed with its
    // extension.
    const previous = `$__${id}_previous_completer`;
    const names = ["", ".exe", ".cmd", ".bat"].map((extension) => nuQuote(name + extension)).join(" ");
    return `let __${id}_previous_completer = $env.config.completions.external.completer?
$env.config.completions.external.completer = {|spans|
  let words = $spans | each {|span|
    let quote = $span | str substring 0..0
    if $quote in ["'", '"', '\`'] { $span | str substring 1.. | str trim --right --char $quote } else { $span }
  }
  let command = $words.0
  if ($command | path basename) not-in [${names}] {
    return (if ${previous} != null { do ${previous} $spans })
  }
  if (which $command | is-empty) { return }
  $env.SHELL_COMPLETION_GENERATOR = 'nushell'
  ^$command completion complete --shell nushell --gate-options -- ...($words | skip 1)
    | complete
    | get stdout
    | lines
    | each {|line|
      let parts = $line | split row "\\t"
      { value: $parts.0, description: ($parts | get 1? | default "") }
    }
}`;
  }
  // fish
  return `function __${id}_complete
  set -l toks (commandline -opc)
  set -l cur (commandline -ct)
  set -l bin $toks[1]
  command -q -- $bin; or test -x "$bin"; or return
  set -lx SHELL_COMPLETION_GENERATOR fish
  $bin completion complete --shell fish --gate-options -- $toks[2..-1] $cur 2>/dev/null
end
complete -c ${fishQuote(name)} -f -a '(__${id}_complete)'`;
}

// }}}

/** Generate a completion script for `shell` from a CLI spec. */
export function getCompletion(spec: Spec, shell: Shell): string {
  return renderRuntimeShim(spec, shell);
}

// Completion commands {{{

/**
 * Hidden machine-facing subcommand the completion scripts call on every Tab.
 * The tokens after `--` are the command line; the last is the word being
 * completed. With `--shell`, prints the lines {@link formatCandidates} makes
 * for that shell. Without it, prints `value\tdescription` lines.
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
    {
      name: "--shell",
      description: "Print the lines this shell's completion script reads",
      args: { name: "shell", parse: shellSchema },
    },
  ],
  args: { name: "tokens", isVariadic: true, isOptional: true },
  async action({ path, args, options }) {
    const spec = path[0] as Spec;
    const shell = options.get("--shell") as Shell | undefined;
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
    if (shell) {
      const lines = formatCandidates(candidates, shell, partial);
      // Written without print, which would trim a space that ends the last value.
      if (lines.length > 0) {
        output.write(1, `${lines.join("\n")}\n`);
      }
      return 0;
    }
    // Scripts from 3.1.0 don't pass --shell and read the candidates as they
    // are, so they still get them that way.
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

/**
 * Subcommand that prints an installation script for the requested shell.
 * Without an argument, list supported shells. Add it to the root's `subcommands`.
 *
 * Generate and load the script at shell startup. The script and its internal
 * completion protocol can change between releases.
 *
 * Each completion request starts a new CLI process. Scripts set
 * `SHELL_COMPLETION_GENERATOR` to the shell name. Completion calls argument
 * generators without running the selected command's action.
 */
export const completion: Subcommand = {
  name: "completion",
  description: "Print a shell completion script",
  args: {
    name: "shell",
    isOptional: true,
    description: "Shell to print the script for",
    parse: shellSchema,
  },
  subcommands: [completeCommand],
  action({ path, args }) {
    const spec = path[0] as Spec;
    const shell = args[0] as Shell | undefined;
    if (shell === undefined) {
      print(`Supported shells: ${SHELLS.join(", ")}`);
      return 0;
    }

    print(getCompletion(spec, shell));
    return 0;
  },
};
