/**
 * Shell completion script generation.
 *
 * `getCompletion` walks a spec and renders a static completion script for a
 * supported shell. The `completion` subcommand wires this into a CLI the same
 * way `helpCommand` wires in help: drop it into `subcommands` and users get
 * `mycli completion <shell>`.
 *
 * Every renderer uses the same shape: descend through the typed subcommand
 * tokens to a stable "node key", then offer that node's candidate tokens
 * (subcommands + options). Options and subcommands inherited from ancestors
 * (persistent options) are resolved during the walk.
 *
 * Argument values are completed from the Fig-style metadata on a option's first
 * argument: `template` (file/folder paths), static `suggestions`, and dynamic
 * `generators`. A dynamic generator is run by re-invoking the CLI's hidden
 * `completion generate-suggestions <location>` command, where `<location>` is a
 * base64-encoded pointer to the generator inside the spec.
 *
 * @module
 */

import type { Arg, Option, Generator, Spec, Subcommand, Template } from "./types.js";
import { asArray, makeArray, print, printActionError } from "./util.js";
import { analyze } from "./analyze.js";
import { getMaxArgs } from "./parse.js";

/** Shells that {@link getCompletion} can generate scripts for. */
export type Shell = "bash" | "zsh" | "fish";

/** How a completion script resolves candidates. */
export type Mode = "runtime" | "shell";

export const SHELLS: readonly Shell[] = ["bash", "zsh", "fish"];

function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value);
}

/** A pointer to a generator inside the spec, carried through base64. */
interface Location {
  /** Subcommand tokens (primary names) from the root to the command. */
  path: string[];
  /** Owning option's name, or omitted for a positional argument. */
  option?: string;
  /** Index into the option's (or command's) args. */
  argIndex: number;
  /** Index into that argument's generators. */
  genIndex: number;
}

/** Completion behavior derived from an argument's Fig-style metadata. */
interface ArgComplete {
  template?: Template;
  /** Static suggestion values (already flattened to insertable strings). */
  staticValues: string[];
  /** base64 location of the first `custom` generator, if any. */
  customLocation?: string;
}

interface OptionInfo {
  /** Every alias of the option, e.g. `["-v", "--verbose"]`. */
  tokens: string[];
  description: string;
  takesArg: boolean;
  argComplete?: ArgComplete;
}

interface SubInfo {
  /** Every alias of the child subcommand. */
  tokens: string[];
  description: string;
}

interface Node {
  /** Stable key identifying this command's position in the tree. */
  key: string;
  /** Subcommand tokens (primary names) from the root to this command. */
  path: string[];
  subcommands: SubInfo[];
  options: OptionInfo[];
  /** Completion for the command's positional argument, if any. */
  positional?: ArgComplete;
  /** One entry per child alias, mapping a typed token to the child's key. */
  transitions: { token: string; childKey: string }[];
}

const firstLine = (description: string | undefined): string =>
  description ? description.split("\n", 1)[0].trim() : "";

/** Turn an arbitrary name into a safe shell identifier fragment. */
const sanitize = (value: string): string => value.replace(/[^A-Za-z0-9]+/g, "_");

// base64(JSON) location encoding {{{

function encodeLocation(location: Location): string {
  const bytes = new TextEncoder().encode(JSON.stringify(location));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeLocation(encoded: string): Location {
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes)) as Location;
}

// }}}

/** Build {@link ArgComplete} for one argument at a known spec location. */
function argCompleteFor(arg: Arg, location: Omit<Location, "genIndex">): ArgComplete | undefined {
  const staticValues = (arg.suggestions ?? []).map((suggestion) =>
    typeof suggestion === "string" ? suggestion : makeArray(suggestion.name)[0],
  );

  const generators = makeArray(arg.generators);
  const genIndex = generators.findIndex((generator) => generator.custom);
  const customLocation = genIndex >= 0 ? encodeLocation({ ...location, genIndex }) : undefined;

  if (!arg.template && staticValues.length === 0 && !customLocation) {
    return undefined;
  }
  return { template: arg.template, staticValues, customLocation };
}

/** Completion for a option's first argument, if it has any metadata. */
function optionArgComplete(option: Option, path: string[]): ArgComplete | undefined {
  const arg = asArray(option.args)[0] as Arg | undefined;
  if (!arg) return undefined;
  return argCompleteFor(arg, { path, option: makeArray(option.name)[0], argIndex: 0 });
}

/** Completion for a command's first positional arg that has metadata. */
function positionalComplete(command: Subcommand, path: string[]): ArgComplete | undefined {
  const args = asArray(command.args) as Arg[];
  for (let index = 0; index < args.length; index += 1) {
    const ac = argCompleteFor(args[index], { path, argIndex: index });
    if (ac) return ac;
  }
  return undefined;
}

function toOptionInfo(option: Option, path: string[]): OptionInfo {
  return {
    tokens: makeArray(option.name),
    description: firstLine(option.description),
    takesArg: asArray(option.args).length > 0,
    argComplete: optionArgComplete(option, path),
  };
}

/**
 * Flatten the spec into a list of command nodes. Hidden options and subcommands
 * are excluded; persistent options are propagated to descendants.
 */
function walk(spec: Spec): Node[] {
  const nodes: Node[] = [];

  const recurse = (
    command: Subcommand,
    key: string,
    path: string[],
    inheritedPersistent: Option[],
  ): void => {
    const ownOptions = (command.options ?? []).filter((option) => !option.hidden);
    const children = (command.subcommands ?? []).filter((sub) => !sub.hidden);

    const node: Node = {
      key,
      path,
      subcommands: [],
      options: [...inheritedPersistent, ...ownOptions].map((option) => toOptionInfo(option, path)),
      positional: positionalComplete(command, path),
      transitions: [],
    };

    const childPersistent = [
      ...inheritedPersistent,
      ...ownOptions.filter((option) => option.isPersistent),
    ];

    for (const child of children) {
      const tokens = makeArray(child.name);
      const childKey = `${key}_${sanitize(tokens[0])}`;
      node.subcommands.push({
        tokens,
        description: firstLine(child.description),
      });
      for (const token of tokens) {
        node.transitions.push({ token, childKey });
      }
      recurse(child, childKey, [...path, tokens[0]], childPersistent);
    }

    nodes.push(node);
  };

  recurse(spec as unknown as Subcommand, "cmd", [], []);
  return nodes;
}

/** Single-quote a string for bash/zsh. */
function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Single-quote a string for fish (only `\` and `'` are special). */
function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

/** Every candidate token offered at a node (subcommand aliases + option aliases). */
function candidateTokens(node: Node): string[] {
  const tokens: string[] = [];
  for (const sub of node.subcommands) tokens.push(...sub.tokens);
  for (const option of node.options) tokens.push(...option.tokens);
  return tokens;
}

function renderTransitionCases(nodes: Node[], indent: string): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    for (const { token, childKey } of node.transitions) {
      lines.push(`${indent}${shQuote(`${node.key}::${token}`)}) cmd=${shQuote(childKey)} ;;`);
    }
  }
  return lines;
}

// bash {{{

/**
 * bash candidate lines for an arg. `append` keeps existing COMPREPLY (for a
 * positional, which coexists with subcommands/options); otherwise it replaces.
 * The generator callback uses the typed command and is guarded for resilience.
 */
function bashArgLines(ac: ArgComplete, indent: string, append: boolean): string[] {
  const lines: string[] = [];
  const op = append ? "COMPREPLY+=" : "COMPREPLY=";
  const hasWords = ac.staticValues.length > 0 || ac.customLocation !== undefined;

  if (hasWords) {
    lines.push(
      `${indent}local words=${
        ac.staticValues.length > 0 ? shQuote(ac.staticValues.join(" ")) : '""'
      }`,
    );
    if (ac.customLocation) {
      lines.push(`${indent}if command -v "\${COMP_WORDS[0]}" >/dev/null 2>&1; then`);
      lines.push(
        `${indent}  words="$words $("\${COMP_WORDS[0]}" completion generate-suggestions ${shQuote(ac.customLocation)} -- "\${COMP_WORDS[@]:1}" 2>/dev/null)"`,
      );
      lines.push(`${indent}fi`);
    }
    lines.push(`${indent}${op}( $(compgen -W "$words" -- "$cur") )`);
  }
  if (ac.template) {
    const option = ac.template === "folders" ? "-d" : "-f";
    const fileOp = hasWords || append ? "COMPREPLY+=" : "COMPREPLY=";
    lines.push(`${indent}${fileOp}( $(compgen ${option} -- "$cur") )`);
  }
  return lines;
}

function renderBash(spec: Spec, nodes: Node[]): string {
  const id = sanitize(spec.name);
  const lines: string[] = [];

  lines.push(`_${id}() {`);
  lines.push(`  local cur="\${COMP_WORDS[COMP_CWORD]}"`);
  lines.push(`  local prev="\${COMP_WORDS[COMP_CWORD-1]}"`);
  lines.push(`  local cmd="cmd" i w`);
  lines.push(`  for (( i=1; i < COMP_CWORD; i++ )); do`);
  lines.push(`    w="\${COMP_WORDS[i]}"`);
  lines.push(`    case "$w" in -* ) continue ;; esac`);
  lines.push(`    case "\${cmd}::\${w}" in`);
  lines.push(...renderTransitionCases(nodes, "      "));
  lines.push(`    esac`);
  lines.push(`  done`);

  // Option-argument completion, scoped to the command context + option token.
  const argCases: string[] = [];
  for (const node of nodes) {
    for (const option of node.options) {
      if (!option.argComplete) continue;
      for (const token of option.tokens) {
        argCases.push(`    ${shQuote(`${node.key}::${token}`)})`);
        argCases.push(...bashArgLines(option.argComplete, "      ", false));
        argCases.push(`      return ;;`);
      }
    }
  }
  if (argCases.length > 0) {
    lines.push(`  case "\${cmd}::\${prev}" in`);
    lines.push(...argCases);
    lines.push(`  esac`);
  }

  lines.push(`  local opts=""`);
  lines.push(`  case "$cmd" in`);
  for (const node of nodes) {
    lines.push(`    ${shQuote(node.key)}) opts=${shQuote(candidateTokens(node).join(" "))} ;;`);
  }
  lines.push(`  esac`);
  lines.push(`  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )`);

  // Positional values are offered alongside subcommands/options.
  const posCases: string[] = [];
  for (const node of nodes) {
    if (!node.positional) continue;
    posCases.push(`    ${shQuote(node.key)})`);
    posCases.push(...bashArgLines(node.positional, "      ", true));
    posCases.push(`      ;;`);
  }
  if (posCases.length > 0) {
    lines.push(`  case "$cmd" in`);
    lines.push(...posCases);
    lines.push(`  esac`);
  }

  lines.push(`}`);
  lines.push(`complete -F _${id} ${shQuote(spec.name)}`);
  return lines.join("\n");
}

// }}}

// zsh {{{

/** zsh candidate lines for an arg (used for both option values and positionals). */
function zshArgLines(ac: ArgComplete, indent: string): string[] {
  const lines: string[] = [];
  const hasVals = ac.staticValues.length > 0 || ac.customLocation !== undefined;

  if (hasVals) {
    lines.push(`${indent}local -a vals`);
    lines.push(`${indent}vals=( ${ac.staticValues.map(shQuote).join(" ")} )`);
    if (ac.customLocation) {
      // Typed command, guarded so a missing binary doesn't error.
      lines.push(`${indent}if command -v "$words[1]" >/dev/null 2>&1; then`);
      lines.push(
        `${indent}  vals+=( \${(f)"$("$words[1]" completion generate-suggestions ${shQuote(ac.customLocation)} -- \${words[2,-1]} 2>/dev/null)"} )`,
      );
      lines.push(`${indent}fi`);
    }
    lines.push(`${indent}compadd -a vals`);
  }
  if (ac.template) {
    lines.push(`${indent}${ac.template === "folders" ? "_files -/" : "_files"}`);
  }
  return lines;
}

function renderZsh(spec: Spec, nodes: Node[]): string {
  const id = sanitize(spec.name);
  const lines: string[] = [];

  lines.push(`#compdef ${spec.name}`);
  lines.push(`_${id}() {`);
  lines.push(`  local cmd=cmd i w prev`);
  lines.push(`  for (( i=2; i < CURRENT; i++ )); do`);
  lines.push(`    w="\${words[i]}"`);
  lines.push(`    case "$w" in -* ) continue ;; esac`);
  lines.push(`    case "\${cmd}::\${w}" in`);
  lines.push(...renderTransitionCases(nodes, "      "));
  lines.push(`    esac`);
  lines.push(`  done`);
  lines.push(`  prev="\${words[CURRENT-1]}"`);

  const argCases: string[] = [];
  for (const node of nodes) {
    for (const option of node.options) {
      if (!option.argComplete) continue;
      for (const token of option.tokens) {
        argCases.push(`    ${shQuote(`${node.key}::${token}`)})`);
        argCases.push(...zshArgLines(option.argComplete, "      "));
        argCases.push(`      return ;;`);
      }
    }
  }
  if (argCases.length > 0) {
    lines.push(`  case "\${cmd}::\${prev}" in`);
    lines.push(...argCases);
    lines.push(`  esac`);
  }

  lines.push(`  local -a opts`);
  lines.push(`  case "$cmd" in`);
  for (const node of nodes) {
    const entries: string[] = [];
    for (const sub of node.subcommands) {
      for (const token of sub.tokens) {
        entries.push(shQuote(`${token}:${sub.description}`));
      }
    }
    for (const option of node.options) {
      for (const token of option.tokens) {
        entries.push(shQuote(`${token}:${option.description}`));
      }
    }
    lines.push(`    ${shQuote(node.key)}) opts=( ${entries.join(" ")} ) ;;`);
  }
  lines.push(`  esac`);
  lines.push(`  _describe -t values ${shQuote(spec.name)} opts`);

  // Positional values, offered after the subcommand/option list.
  const posCases: string[] = [];
  for (const node of nodes) {
    if (!node.positional) continue;
    posCases.push(`    ${shQuote(node.key)})`);
    posCases.push(...zshArgLines(node.positional, "      "));
    posCases.push(`      ;;`);
  }
  if (posCases.length > 0) {
    lines.push(`  case "$cmd" in`);
    lines.push(...posCases);
    lines.push(`  esac`);
  }

  lines.push(`}`);
  lines.push(`_${id} "$@"`);
  return lines.join("\n");
}

// }}}

// fish {{{

/** Build the fish `complete` option selectors (`-s x`, `-l long`, `-o old`). */
function fishOptionSelectors(tokens: string[]): string {
  const parts: string[] = [];
  for (const token of tokens) {
    if (token.startsWith("--")) {
      parts.push(`-l ${fishQuote(token.slice(2))}`);
    } else if (token.startsWith("-") && token.length === 2) {
      parts.push(`-s ${fishQuote(token.slice(1))}`);
    } else if (token.startsWith("-") && token.length > 2) {
      parts.push(`-o ${fishQuote(token.slice(1))}`);
    } else {
      // POSIX-noncompliant option (no leading dash): offer it as a plain value.
      parts.push(`-a ${fishQuote(token)}`);
    }
  }
  return parts.join(" ");
}

/** A guarded fish command substitution that runs a generator by location. */
function fishGuardedCallback(location: string): string {
  // `command -q` only searches PATH, so also accept a runnable path (./cli).
  return `(set -l c (commandline -opc)[1]; if command -q -- $c; or test -x "$c"; $c completion generate-suggestions ${location} -- (commandline -opc) 2>/dev/null; end)`;
}

/** The `-a` candidate bits and whether the shell's file completion is wanted. */
function fishValueBits(ac: ArgComplete): { aBits: string; wantsFiles: boolean } {
  const parts: string[] = [...ac.staticValues];
  if (ac.template === "folders" || Array.isArray(ac.template)) {
    parts.push("(__fish_complete_directories)");
  }
  if (ac.customLocation) parts.push(fishGuardedCallback(ac.customLocation));
  const aBits = parts.length > 0 ? ` -a ${fishQuote(parts.join(" "))}` : "";
  const wantsFiles = ac.template === "filepaths" || Array.isArray(ac.template);
  return { aBits, wantsFiles };
}

/**
 * The suffix after a option's selectors. Uses `-x` (exclusive: requires a value
 * and suppresses fish's file fallback) when the arg has its own candidates and
 * isn't a filepaths template; `-r` lets files through when they're wanted.
 */
function fishOptionArgSuffix(option: OptionInfo): string {
  if (!option.takesArg) return "";
  if (!option.argComplete) return " -r"; // takes a value, no metadata: native files
  const { aBits, wantsFiles } = fishValueBits(option.argComplete);
  return `${wantsFiles ? " -r" : " -x"}${aBits}`;
}

function renderFish(spec: Spec, nodes: Node[]): string {
  const id = sanitize(spec.name);
  const name = spec.name;
  const lines: string[] = [];

  lines.push(`function __fish_${id}_at`);
  lines.push(`  set -l cmd cmd`);
  lines.push(`  set -l toks (commandline -opc)`);
  lines.push(`  for w in $toks[2..-1]`);
  lines.push(`    if string match -qr '^-' -- $w`);
  lines.push(`      continue`);
  lines.push(`    end`);
  lines.push(`    switch "$cmd $w"`);
  for (const node of nodes) {
    for (const { token, childKey } of node.transitions) {
      lines.push(`      case ${fishQuote(`${node.key} ${token}`)}`);
      lines.push(`        set cmd ${fishQuote(childKey)}`);
    }
  }
  lines.push(`    end`);
  lines.push(`  end`);
  lines.push(`  test "$cmd" = "$argv[1]"`);
  lines.push(`end`);
  lines.push("");
  // Disable fallback filename completion; commands re-enable it per arg later.
  lines.push(`complete -c ${fishQuote(name)} -f`);
  for (const node of nodes) {
    const guard = `-n ${fishQuote(`__fish_${id}_at ${node.key}`)}`;
    for (const sub of node.subcommands) {
      for (const token of sub.tokens) {
        const desc = sub.description ? ` -d ${fishQuote(sub.description)}` : "";
        lines.push(`complete -c ${fishQuote(name)} ${guard} -a ${fishQuote(token)}${desc}`);
      }
    }
    for (const option of node.options) {
      const desc = option.description ? ` -d ${fishQuote(option.description)}` : "";
      const suffix = fishOptionArgSuffix(option);
      lines.push(
        `complete -c ${fishQuote(name)} ${guard} ${fishOptionSelectors(option.tokens)}${suffix}${desc}`,
      );
    }
    // Positional value completion (global `-f` keeps files out unless -F).
    if (node.positional) {
      const { aBits, wantsFiles } = fishValueBits(node.positional);
      lines.push(`complete -c ${fishQuote(name)} ${guard}${aBits}${wantsFiles ? " -F" : ""}`);
    }
  }
  return lines.join("\n");
}

// }}}

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
  /** A non-persistent option has been used (blocks subcommand matching). */
  usedNonPersistentOption: boolean;
}

function analyzeState(spec: Spec, before: readonly string[]): CompletionState {
  const { tokens, finalState } = analyze<Subcommand, Option>(before, spec);

  const path: Subcommand[] = [spec as unknown as Subcommand];
  let current: Subcommand = spec as unknown as Subcommand;
  let pending: CompletionState["pending"] = null;
  let pendingFilled = 0;
  let pendingMax = 0;
  let positionalIndex = 0;
  let forceArgs = false;
  let sawPositional = false;
  let usedNonPersistentOption = false;
  const presentNames = new Set<string>();
  const countByOption = new Map<Option, number>();

  for (const token of tokens) {
    switch (token.kind) {
      case "subcommand": {
        current = token.subcommand;
        path.push(current);
        positionalIndex = 0;
        sawPositional = false;
        pending = null;
        break;
      }
      case "option": {
        const option = token.option;
        for (const name of makeArray(option.name)) presentNames.add(name);
        countByOption.set(option, (countByOption.get(option) ?? 0) + 1);
        if (!option.isPersistent) usedNonPersistentOption = true;
        const max = getMaxArgs(option.args);
        // requiresSeparator options only take an attached value, never a
        // following separate token, so they never leave a pending value.
        if (max > 0 && !option.requiresSeparator) {
          pending = { option, argIndex: 0 };
          pendingFilled = 0;
          pendingMax = max;
        } else {
          pending = null;
        }
        break;
      }
      case "option-arg": {
        // An attached value (`--option=v`, `-fv`) satisfies the preceding option.
        pending = null;
        break;
      }
      case "arg": {
        if (pending && pendingFilled < pendingMax) {
          pendingFilled += 1;
          pending = { option: pending.option, argIndex: pendingFilled };
          if (pendingFilled >= pendingMax) pending = null;
        } else {
          positionalIndex += 1;
          sawPositional = true;
          pending = null;
        }
        break;
      }
      case "arg-separator": {
        forceArgs = true;
        pending = null;
        break;
      }
      case "unknown-option": {
        pending = null;
        break;
      }
    }
  }

  const availableOptions: Option[] = [];
  const seen = new Set<Option>();
  for (const map of [finalState.localOptions, finalState.persistentOptions]) {
    for (const option of map.values()) {
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
    usedNonPersistentOption,
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

/** Pick the argument being completed at a positional index (honors variadic). */
function positionalArg(command: Subcommand, index: number): Arg | undefined {
  const args = asArray(command.args) as readonly Arg[];
  if (args.length === 0) return undefined;
  if (index < args.length) return args[index];
  const last = args[args.length - 1];
  return last?.isVariadic ? last : undefined;
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
    const arg = (asArray(state.pending.option.args) as Arg[])[state.pending.argIndex];
    return arg ? argValues(arg, tokens, req.partial) : [];
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

  const posixNoncompliant = directiveOnPath(state.path, "flagsArePosixNoncompliant");
  const partialIsOption =
    !posixNoncompliant && (req.partial.startsWith("-") || req.partial.startsWith("+"));
  // When gating, a dashed word completes options only; everything else completes
  // commands/positionals. Posix-noncompliant options have no dash, so they're
  // exempt and always offered alongside the other candidates.
  const wantValues = !(req.gateOptions && partialIsOption);
  const wantOptions = !req.gateOptions || partialIsOption || posixNoncompliant;

  if (wantValues) {
    const positional = positionalArg(state.current, state.positionalIndex);
    if (positional) {
      candidates.push(...(await argValues(positional, tokens, req.partial)));
    }
    // After `--`, only positionals are valid.
    if (state.forceArgs) return candidates;

    // Subcommands — only while the parser would still match one.
    if (!state.sawPositional && !state.usedNonPersistentOption) {
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

  // Options — unless they must precede arguments and one was already seen.
  const optionsBlocked =
    state.sawPositional && directiveOnPath(state.path, "optionsMustPrecedeArguments");
  if (wantOptions && !optionsBlocked) {
    candidates.push(...optionCandidates(state, separators));
  }

  return candidates;
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
export function getCompletion(spec: Spec, shell: Shell, mode: Mode = "runtime"): string {
  if (mode === "runtime") return renderRuntimeShim(spec, shell);
  const nodes = walk(spec);
  switch (shell) {
    case "bash":
      return renderBash(spec, nodes);
    case "zsh":
      return renderZsh(spec, nodes);
    case "fish":
      return renderFish(spec, nodes);
  }
}

// Dynamic suggestion runtime {{{

/** Resolve the argument a {@link Location} points at, or null if it's stale. */
function resolveArg(spec: Spec, location: Location): Arg | null {
  let command = spec as unknown as Subcommand;
  let ancestorPersistent: Option[] = [];

  for (const segment of location.path) {
    ancestorPersistent = [
      ...ancestorPersistent,
      ...(command.options ?? []).filter((option) => option.isPersistent),
    ];
    const child = (command.subcommands ?? []).find((sub) => makeArray(sub.name).includes(segment));
    if (!child) return null;
    command = child;
  }

  let args: readonly Arg[];
  if (location.option !== undefined) {
    const available = [...ancestorPersistent, ...(command.options ?? [])];
    const option = available.find((candidate) =>
      makeArray(candidate.name).includes(location.option!),
    );
    if (!option) return null;
    args = asArray(option.args);
  } else {
    args = asArray(command.args);
  }

  return args[location.argIndex] ?? null;
}

/**
 * Run the generator a base64 location points at and return its suggestions as
 * insertable strings, or null if the location is invalid.
 */
async function generateSuggestions(
  spec: Spec,
  encoded: string,
  tokens: string[],
): Promise<string[] | null> {
  let location: Location;
  try {
    location = decodeLocation(encoded);
  } catch {
    return null;
  }

  const arg = resolveArg(spec, location);
  if (!arg) return null;

  const generator: Generator | undefined = makeArray(arg.generators)[location.genIndex];
  if (!generator?.custom) return null;

  const suggestions = await generator.custom(tokens);
  return suggestions.map((suggestion) =>
    typeof suggestion === "string" ? suggestion : makeArray(suggestion.name)[0],
  );
}

/**
 * Hidden machine-facing subcommand that generated scripts call back into to
 * run a `custom` generator. Not shown in help.
 */
const generateSuggestionsCommand: Subcommand = {
  name: "generate-suggestions",
  description: "Print dynamic suggestions for a completion generator",
  hidden: true,
  args: [{ name: "location" }, { name: "tokens", isVariadic: true, isOptional: true }],
  async action({ path, args: [encoded, ...tokens] }) {
    const spec = path[0] as Spec;
    if (encoded === undefined) {
      printActionError("Missing generator location");
      return 1;
    }
    const suggestions = await generateSuggestions(spec, encoded, tokens);
    if (suggestions === null) {
      printActionError(`Unknown generator location '${encoded}'`);
      return 1;
    }
    if (suggestions.length > 0) {
      print(suggestions.join("\n"));
    }
    return 0;
  },
};

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
  options: [
    {
      name: "--runtime",
      description: "Resolve candidates by invoking the CLI (default)",
      exclusiveOn: ["--shell"],
    },
    {
      name: "--shell",
      description: "Emit a self-contained script with no per-Tab CLI call",
      exclusiveOn: ["--runtime"],
    },
  ],
  subcommands: [completeCommand, generateSuggestionsCommand],
  action({ path: [spec], args: [shell], options, help }) {
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

    const mode: Mode = options.has("--shell") ? "shell" : "runtime";
    print(getCompletion(spec, shell, mode));
    return 0;
  },
};
