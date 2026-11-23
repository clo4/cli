/**
 * What the word being typed can become: the subcommands, options and values
 * the parser accepts there. The parser reads the line with `readNext`, so
 * completion always matches what it accepts: subcommands, options with their
 * relationship rules, and the values of the argument the word is for, from its
 * `suggestions`, `suggest`, `template` or parser.
 *
 * The shells' completion scripts are adapters of {@link complete}.
 *
 * @module
 */

import type { Arg, Spec, Suggestion, SuggestInit, Template } from "./types.js";
import { parserCompletions } from "./description.js";
import { shownDescription } from "./help.js";
import { readNext } from "./parse.js";
import type { NextToken } from "./parse.js";
import { formStart } from "./scope.js";

/**
 * What the word being typed can become. An option's names, a subcommand's
 * aliases and a suggestion's names are one completion with each of its values,
 * in the order the spec lists them, so a prompt can show them together. A shell
 * lists each value.
 */
export interface Completion {
  /** The values that mean the same thing. There's at least one. */
  values: readonly string[];
  /** The first line of the description, as help shows it. */
  description?: string;
  /** The values need more text after them, like `1920x`, so no space follows. */
  open?: boolean;
}

/** The first line of a description as help shows it. */
function firstLine(description: string | undefined): string | undefined {
  const shown = shownDescription(description);
  return shown ? shown.split("\n", 1)[0].trim() : undefined;
}

function fromSuggestion(suggestion: Suggestion | string): Completion {
  if (typeof suggestion === "string") {
    return { values: [suggestion] };
  }
  const name = suggestion.name;
  return { values: typeof name === "string" ? [name] : name, description: firstLine(suggestion.description) };
}

/** The file system entries that `word` could become, for a path template. */
async function paths(word: string, template: Template): Promise<Completion[]> {
  // Imported through a variable so the Node-free `src` build doesn't need
  // @types/node. Only completion reads the file system.
  const specifier = "node:fs";
  const { readdirSync } = (await import(specifier)) as {
    readdirSync(path: string, options: { withFileTypes: true }): { name: string; isDirectory(): boolean }[];
  };
  // Windows paths can use either separator. Elsewhere `\` is part of a name.
  const isWindows = (globalThis as { process?: { platform?: string } }).process?.platform === "win32";
  const slash = Math.max(word.lastIndexOf("/"), isWindows ? word.lastIndexOf("\\") : -1);
  const dir = slash >= 0 ? word.slice(0, slash + 1) : "";
  const base = slash >= 0 ? word.slice(slash + 1) : word;
  // A folder ends with the separator the user typed last.
  const separator = slash >= 0 ? word[slash] : "/";
  const foldersOnly = template === "folders";
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync((isWindows ? dir.replaceAll("\\", "/") : dir) || ".", { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Completion[] = [];
  for (const entry of entries) {
    if (!entry.name.startsWith(base)) {
      continue;
    }
    const isDir = entry.isDirectory();
    if (foldersOnly && !isDir) {
      continue;
    }
    found.push({ values: [`${dir}${entry.name}${isDir ? separator : ""}`] });
  }
  return found;
}

/**
 * The values `arg` offers for `init.word`: its `suggestions`, then what each
 * suggester gives, in order, then the paths its template matches. An argument
 * that says nothing about completion offers what its parser accepts.
 */
async function argValues(arg: Arg, init: SuggestInit): Promise<Completion[]> {
  const found: Completion[] = [];
  for (const suggestion of arg.suggestions ?? []) {
    found.push(fromSuggestion(suggestion));
  }
  const suggest = arg.suggest;
  if (suggest) {
    const given = await Promise.all(
      typeof suggest === "function" ? [suggest(init)] : suggest.map((s) => s(init)),
    );
    for (const suggestions of given) {
      for (const suggestion of suggestions) {
        found.push(fromSuggestion(suggestion));
      }
    }
  }
  if (arg.template) {
    found.push(...(await paths(init.word, arg.template)));
  }
  if (arg.suggestions === undefined && suggest === undefined && arg.template === undefined) {
    for (const { value, open } of parserCompletions(arg, init.word)) {
      found.push(open ? { values: [value], open } : { values: [value] });
    }
  }
  return found;
}

/** What `complete` reads the line as, besides the spec and the words. */
export interface CompleteOptions {
  /**
   * Offer options only once the word starts one of their names, and offer no
   * values when the parser reads the word as an option. Without it, options
   * are offered with everything else. Default: false.
   */
  optionsNeedDash?: boolean;
}

/** Which kinds of value the word can become. */
function wanted(next: NextToken, word: string, optionsNeedDash: boolean) {
  // Options that aren't POSIX compliant have no dash to wait for.
  if (!optionsNeedDash || next.directives.flagsArePosixNoncompliant) {
    return { values: true, options: true, subcommand: (_name: string) => true };
  }
  const starts = (name: string) => word !== "" && name.startsWith(word);
  const values = !next.partialIsOption;
  return {
    values,
    options: word !== "" && next.options().some(({ forms }) => forms.some(({ name }) => starts(name))),
    // A subcommand named like an option is offered once the word starts its name.
    subcommand: (name: string) => values || starts(name),
  };
}

/**
 * What `word` can become after `before`, as the parser reads the line:
 * subcommands, options, and the values of the argument the word is for.
 * `before` is the words after the program's name. Each value is offered once.
 *
 * It's what the `completion` command's scripts ask a CLI on each Tab, and the
 * way to complete a CLI's command line anywhere else, like in a prompt.
 */
export async function complete(
  spec: Spec,
  before: readonly string[],
  word: string,
  options?: CompleteOptions,
): Promise<Completion[]> {
  const next = await readNext(spec, before, word);
  const found: Completion[] = [];

  if (next.attached) {
    // The word is an option with a value attached, like `--mode=fa`.
    const { prefix, arg, value } = next.attached;
    for (const completion of await argValues(arg, { ...next.line, word: value })) {
      found.push({ ...completion, values: completion.values.map((value) => prefix + value) });
    }
  } else if (next.value?.required) {
    // The open option needs the word as its value.
    if (next.value.arg) {
      found.push(...(await argValues(next.value.arg, { ...next.line, word })));
    }
  } else {
    const want = wanted(next, word, options?.optionsNeedDash ?? false);
    // While an option can take another value, a word that isn't an option or
    // subcommand is its value instead of an argument.
    const arg = next.value ? next.value.arg : next.arg;
    if (want.values && arg) {
      // The parser reads a subcommand's name as the subcommand, so it can't be a value.
      const taken = new Set<string>();
      for (const { names } of next.subcommands()) {
        for (const name of names) {
          taken.add(name);
        }
      }
      for (const completion of await argValues(arg, { ...next.line, word })) {
        const free = completion.values.filter((value) => !taken.has(value));
        if (free.length > 0) {
          found.push({ ...completion, values: free });
        }
      }
    }
    for (const { command, names } of next.subcommands()) {
      if (!command.hidden) {
        const offered = names.filter(want.subcommand);
        if (offered.length > 0) {
          found.push({ values: offered, description: firstLine(command.description) });
        }
      }
    }
    if (want.options) {
      found.push(...optionCompletions(next));
    }
  }
  return once(found);
}

/** The options the word can be, required ones first. */
function optionCompletions(next: NextToken): Completion[] {
  const required: Completion[] = [];
  const optional: Completion[] = [];
  for (const { option, forms, used } of next.options()) {
    // The parser lets a later use of an option override an earlier one, but
    // that's rarely what someone wants, so an option that isn't repeatable is
    // offered once.
    if (option.hidden || (used && !option.isRepeatable)) {
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
    const values = forms.filter((form) => form.join !== "").map(formStart);
    if (values.length > 0) {
      (option.isRequired ? required : optional).push({ values, description });
    }
  }
  return [...required, ...optional];
}

/** `found` with each value once, where it first appears. */
function once(found: Completion[]): Completion[] {
  const seen = new Set<string>();
  const kept: Completion[] = [];
  for (const completion of found) {
    const values = completion.values.filter((value) => !seen.has(value));
    for (const value of values) {
      seen.add(value);
    }
    if (values.length === completion.values.length) {
      kept.push(completion);
    } else if (values.length > 0) {
      kept.push({ ...completion, values });
    }
  }
  return kept;
}
