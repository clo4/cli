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

import type { Arg, SingleOrArray, Spec, Suggestion, SuggestInit, Template } from "./types.js";
import { parserCompletions } from "./description.js";
import { shownDescription } from "./help.js";
import { readNext } from "./parse.js";
import type { NextToken } from "./parse.js";
import { formStart } from "./scope.js";
import { host } from "./host.js";
import { asArray, singleOrArray } from "./util.js";

/** The first line of a description as help shows it. */
function firstLine(description: string | undefined): string | undefined {
  const shown = shownDescription(description);
  return shown ? shown.split("\n", 1)[0].trim() : undefined;
}

/** The names of `name` that `keep` accepts, or undefined if it accepts none. */
function keepNames(
  name: SingleOrArray<string>,
  keep: (name: string) => boolean,
): SingleOrArray<string> | undefined {
  if (typeof name === "string") {
    return keep(name) ? name : undefined;
  }
  return name.every(keep) ? name : singleOrArray(name.filter(keep));
}

/** A suggestion as completion offers it: an object, with its description's first line. */
function offered(suggestion: Suggestion | string): Suggestion {
  if (typeof suggestion === "string") {
    return { name: suggestion };
  }
  return { ...suggestion, description: firstLine(suggestion.description) };
}

/** The file system entries that `word` could become, for a path template. */
function paths(word: string, template: Template): Suggestion[] {
  // Windows paths can use either separator. Elsewhere `\` is part of a name.
  const isWindows = host.windows();
  const slash = Math.max(word.lastIndexOf("/"), isWindows ? word.lastIndexOf("\\") : -1);
  const dir = slash >= 0 ? word.slice(0, slash + 1) : "";
  const base = slash >= 0 ? word.slice(slash + 1) : word;
  // A folder ends with the separator the user typed last.
  const separator = slash >= 0 ? word[slash] : "/";
  const foldersOnly = template === "folders";
  const entries = host.entries((isWindows ? dir.replaceAll("\\", "/") : dir) || ".");
  const found: Suggestion[] = [];
  for (const entry of entries ?? []) {
    if (!entry.name.startsWith(base)) {
      continue;
    }
    const isDir = entry.isDirectory();
    if (foldersOnly && !isDir) {
      continue;
    }
    found.push({ name: `${dir}${entry.name}${isDir ? separator : ""}` });
  }
  return found;
}

/**
 * The values `arg` offers for `init.word`: its `suggestions`, then what each
 * suggester gives, in order, then the paths its template matches. An argument
 * that says nothing about completion offers what its parser accepts.
 */
async function argValues(arg: Arg, init: SuggestInit): Promise<Suggestion[]> {
  const found: Suggestion[] = [];
  for (const suggestion of arg.suggestions ?? []) {
    found.push(offered(suggestion));
  }
  const suggest = arg.suggest;
  if (suggest) {
    const given = await Promise.all(
      typeof suggest === "function" ? [suggest(init)] : suggest.map((s) => s(init)),
    );
    for (const suggestions of given) {
      for (const suggestion of suggestions) {
        found.push(offered(suggestion));
      }
    }
  }
  if (arg.template) {
    found.push(...paths(init.word, arg.template));
  }
  if (arg.suggestions === undefined && suggest === undefined && arg.template === undefined) {
    found.push(...parserCompletions(arg, init.word));
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
 *
 * The caller matches the suggestions against `word`, because each shell
 * matches its own way: fish fuzzily, zsh by the user's matcher-list, and
 * PowerShell and Nushell in any case. Only what's worked out from `word`
 * depends on it, like the files a template lists, or how a parser's pattern
 * goes on.
 */
export async function complete(
  spec: Spec,
  before: readonly string[],
  word: string,
  options?: CompleteOptions,
): Promise<Suggestion[]> {
  const next = await readNext(spec, before, word);
  const found: Suggestion[] = [];

  if (next.attached) {
    // The word is an option with a value attached, like `--mode=fa`.
    const { prefix, arg, value } = next.attached;
    for (const suggestion of await argValues(arg, { ...next.line, word: value })) {
      const { name } = suggestion;
      found.push({
        ...suggestion,
        name: typeof name === "string" ? prefix + name : singleOrArray(name.map((n) => prefix + n))!,
      });
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
      for (const suggestion of await argValues(arg, { ...next.line, word })) {
        const name = keepNames(suggestion.name, (n) => !taken.has(n));
        if (name !== undefined) {
          found.push({ ...suggestion, name });
        }
      }
    }
    for (const { command, names } of next.subcommands()) {
      if (!command.hidden) {
        const name = singleOrArray(names.filter(want.subcommand));
        if (name !== undefined) {
          found.push(offered({ name, description: command.description }));
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
function optionCompletions(next: NextToken): Suggestion[] {
  const required: Suggestion[] = [];
  const optional: Suggestion[] = [];
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
    // so the next Tab completes the value, with no space between. A name
    // joined with nothing between, like `-` in `-5`, is only the option once
    // the value is typed, so it isn't offered. An option's names all take the
    // same separator.
    const joined = forms.filter((form) => form.join !== "");
    const name = singleOrArray(joined.map(formStart));
    if (name !== undefined) {
      const suggestion: Suggestion = { name, description };
      if (joined[0].join !== null) {
        suggestion.incomplete = true;
      }
      (option.isRequired ? required : optional).push(suggestion);
    }
  }
  return [...required, ...optional];
}

/** `found` with each name once, where it first appears. */
function once(found: Suggestion[]): Suggestion[] {
  const seen = new Set<string>();
  const kept: Suggestion[] = [];
  for (const suggestion of found) {
    const name = keepNames(suggestion.name, (n) => !seen.has(n));
    if (name === undefined) {
      continue;
    }
    for (const n of asArray(name)) {
      seen.add(n);
    }
    kept.push(name === suggestion.name ? suggestion : { ...suggestion, name });
  }
  return kept;
}
