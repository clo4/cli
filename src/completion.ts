/**
 * The `completion` command: a script for each shell, and the hidden command
 * those scripts run on every Tab. Each shell is an adapter of
 * {@link complete}. Like any spec, it's written with the public functions
 * alone, `choice`, `complete` and `print`.
 *
 * @module
 */

import type { Spec, Subcommand, Suggestion } from "./types.js";
import { complete } from "./complete.js";
import { choice } from "./schemas.js";
import { print } from "./util.js";

/**
 * What one shell's completion needs: the script that registers a CLI's
 * completion with it, and the lines that script reads back on each Tab.
 */
interface ShellAdapter {
  /**
   * The script for the CLI `name`: a thin shim that forwards the line to
   * `completion complete`. `id` is `name` as a fragment of a shell identifier.
   */
  script(name: string, id: string): string;
  /** The lines the script reads for `candidates`, the values `word` can become. */
  lines(candidates: readonly Candidate[], word: string): string[];
}

/** One value a suggestion offers, as a shell gets it. */
interface Candidate {
  value: string;
  /** The suggestion's description, on one line, or "". */
  description: string;
  incomplete: boolean | undefined;
}

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

/** Whether `value` starts with `word`, ignoring case. */
function startsWithAnyCase(value: string, word: string): boolean {
  return value.slice(0, word.length).toLowerCase() === word.toLowerCase();
}

/*
 * Each shell's script runs the CLI as it was typed, so `./pack` works, and
 * does nothing if there's no such command, so a missing command means no
 * completion instead of an error. It passes `--shell`, so the CLI prints
 * lines ready for that shell.
 */

/**
 * Bash: the quoted value, then a space unless the value is incomplete. Bash
 * inserts a candidate as written and doesn't filter, so only the values whose
 * quoted form starts with the word are kept.
 */
const bash: ShellAdapter = {
  script(name, id) {
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
  },
  lines(candidates, word) {
    const lines: string[] = [];
    for (const { value, incomplete } of candidates) {
      const text = value.replace(/[ '"\\$`|&;()<>{}*?[!#~]/g, "\\$&");
      if (text.startsWith(word)) {
        lines.push(incomplete ? text : `${text} `);
      }
    }
    return lines;
  },
};

/**
 * Zsh: `value:description` for `_describe`, with `\` and `:` escaped in the
 * value, then a tab if the value is incomplete. Zsh filters and quotes the
 * values itself.
 */
const zsh: ShellAdapter = {
  script(name, id) {
    // The CLI gets the words without their quotes. Zsh leaves the quote that
    // opens the word being completed out of $PREFIX, and (Q) removes the rest.
    // A line that ends with a tab is a value that needs more text, and -S ''
    // stops zsh adding a space after it.
    //
    // The same script works evaluated in .zshrc and as a file on $fpath. Zsh
    // sets $compstate only while it completes, so when zsh runs the file as a
    // completion function, the script completes the word. Evaluated, it
    // registers the function for the command instead.
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
if (( \${+compstate} )); then
  _${id}_complete "$@"
else
  compdef _${id}_complete ${shQuote(name)}
fi`;
  },
  lines(candidates) {
    return candidates.map(({ value, description, incomplete }) => {
      // `_describe` splits at the first colon without a backslash before it,
      // then removes the backslashes from both parts.
      const text = value.replace(/[\\:]/g, "\\$&");
      const line = description ? `${text}:${description.replaceAll("\\", "\\\\")}` : text;
      return incomplete ? `${line}\t` : line;
    });
  },
};

/**
 * Fish: `value<Tab>description`. Fish filters and quotes the values itself.
 * It adds a space after the only value that starts with the word, and has no
 * way to be told not to. So an incomplete value that would be the only one is
 * followed by the same value with a `.` after it. Fish then has two values,
 * and inserts what they share with no space.
 */
const fish: ShellAdapter = {
  script(name, id) {
    return `function __${id}_complete
  set -l toks (commandline -opc)
  set -l cur (commandline -ct)
  set -l bin $toks[1]
  command -q -- $bin; or test -x "$bin"; or return
  set -lx SHELL_COMPLETION_GENERATOR fish
  $bin completion complete --shell fish --gate-options -- $toks[2..-1] $cur 2>/dev/null
end
complete -c ${fishQuote(name)} -f -a '(__${id}_complete)'`;
  },
  lines(candidates, word) {
    // Fish takes the values that start with the word as written, or else in any case.
    let matches = candidates.filter(({ value }) => value.startsWith(word));
    if (matches.length === 0) {
      matches = candidates.filter(({ value }) => startsWithAnyCase(value, word));
    }
    const only = matches.length === 1 ? matches[0] : undefined;
    const lines: string[] = [];
    for (const candidate of candidates) {
      const { value, description } = candidate;
      lines.push(description ? `${value}\t${description}` : value);
      if (candidate === only && candidate.incomplete) {
        lines.push(`${value}.`);
      }
    }
    return lines;
  },
};

/**
 * PowerShell: `text<Tab>value<Tab>tooltip`, the arguments of a
 * CompletionResult. Only values that start with the word, ignoring case.
 */
const powershell: ShellAdapter = {
  script(name) {
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
  },
  lines(candidates, word) {
    const lines: string[] = [];
    for (const { value, description } of candidates) {
      if (startsWithAnyCase(value, word)) {
        const text = /[\s'"`$&|;,(){}<>@#\u2018-\u201e]/.test(value) ? psQuote(value) : value;
        // A CompletionResult needs a tooltip, so the value stands in for a
        // missing description.
        lines.push(`${text}\t${value}\t${description || value}`);
      }
    }
    return lines;
  },
};

/** Nushell: `text<Tab>description`. Only values that start with the word, ignoring case. */
const nushell: ShellAdapter = {
  script(name, id) {
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
  },
  lines(candidates, word) {
    const lines: string[] = [];
    for (const { value, description } of candidates) {
      if (startsWithAnyCase(value, word)) {
        const text = /[\s'"`$|;#()[\]{}]/.test(value) ? nuQuote(value) : value;
        lines.push(description ? `${text}\t${description}` : text);
      }
    }
    return lines;
  },
};

const shellNames = ["bash", "zsh", "fish", "powershell", "nushell"] as const;

/** Shells supported by the built-in `completion` subcommand. */
export type Shell = (typeof shellNames)[number];

const shells: Record<Shell, ShellAdapter> = { bash, zsh, fish, powershell, nushell };

/** Accepts a supported shell. Help lists the shells and completion offers them. */
const shellSchema = /* @__PURE__ */ choice(...shellNames);

/**
 * Write suggestions as the lines `shell`'s completion script reads, one line
 * per name. `word` is the word being completed, as the script passed it. Each
 * name of a suggestion gets its description, so fish and zsh show the names
 * that share it together, as they do for their own completions.
 *
 * A value with a tab or line break doesn't fit on a line, so it's left out.
 * A description's tabs and line breaks become spaces.
 */
export function formatCandidates(suggestions: readonly Suggestion[], shell: Shell, word: string): string[] {
  const candidates: Candidate[] = [];
  for (const { name, description, incomplete } of suggestions) {
    const shown = description?.replace(/\s*[\t\n\r]\s*/g, " ").trim() ?? "";
    for (const value of typeof name === "string" ? [name] : name) {
      if (value !== "" && !/[\t\n\r]/.test(value)) {
        candidates.push({ value, description: shown, incomplete });
      }
    }
  }
  return shells[shell].lines(candidates, word);
}

/** The completion script of `spec` for `shell`. */
export function script(spec: Spec, shell: Shell): string {
  return shells[shell].script(spec.name, sanitize(spec.name));
}

/**
 * Hidden machine-facing subcommand the completion scripts call on every Tab.
 * The words after `--` are the command line; the last is the word being
 * completed. Prints the lines {@link formatCandidates} makes for `--shell`.
 */
const completeCommand: Subcommand = {
  name: "complete",
  description: "Resolve completion candidates for a partial command line",
  hidden: true,
  options: [
    {
      name: "--shell",
      description: "Print the lines this shell's completion script reads",
      // The built-ins use the public interface the way any spec does, so this
      // parser costs each Tab what a parser costs any CLI that has one. Make
      // that cheaper in the shared code rather than leave the parser out here.
      args: { name: "shell", parse: shellSchema },
      isRequired: true,
    },
    {
      name: "--gate-options",
      description: "Only suggest options after a leading dash",
    },
    {
      name: "--empty-word",
      description: "The word being completed is empty, so every word is before it",
    },
  ],
  args: { name: "words", isVariadic: true, isOptional: true },
  async action({ path, args, options }) {
    // Windows PowerShell drops an empty argument, so its script says the word
    // is empty with --empty-word instead of passing "".
    const emptyWord = options.has("--empty-word");
    const word = emptyWord || args.length === 0 ? "" : args[args.length - 1];
    const before = emptyWord ? args : args.slice(0, -1);
    const completions = await complete(path[0], before, word, {
      optionsNeedDash: options.has("--gate-options"),
    });
    const lines = formatCandidates(completions, options.get("--shell") as Shell, word);
    if (lines.length > 0) {
      print(lines.join("\n"));
    }
  },
};

/**
 * Subcommand that prints an installation script for the requested shell.
 * Without an argument, list supported shells. Add it to the root's `subcommands`.
 *
 * Generate and load the script at shell startup. The script and its internal
 * completion protocol can change between releases.
 *
 * Each completion request starts a new CLI process. Scripts set
 * `SHELL_COMPLETION_GENERATOR` to the shell name. Completion calls argument
 * suggesters without running the selected command's action.
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
    const shell = args[0] as Shell | undefined;
    print(shell ? script(path[0], shell) : `Supported shells: ${shellNames.join(", ")}`);
  },
};
