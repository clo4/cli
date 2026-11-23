/**
 * The completion menu, as a shell's: it offers what the word at the caret can
 * become, Tab completes as far as the items agree and then moves through them,
 * and accepting one opens the menu for the next word.
 */

import * as CLI from "@clo4/cli";
import type { Arg, Spec } from "@clo4/cli";
import { readNext } from "@clo4/cli/unstable";
import { asArray } from "./util";
import { wordAt, type Word } from "./words";

/** A suggestion in the menu. */
export interface Item {
  /** The names it's shown by, like `-t` and `--times`. */
  names: readonly string[];
  /** What accepting it puts in place of the word: the longest name that starts with it. */
  insert: string;
  description?: string;
  /** No space follows it. */
  incomplete?: boolean;
  /** It's the word as typed, kept for the argument named here, which takes any text. */
  typed?: string;
}

export interface Menu {
  word: Word;
  items: Item[];
  /** The selected item, or -1 before one is. */
  selected: number;
}

/** A change to the line. */
export interface Edit {
  line: string;
  caret: number;
}

/** What the word at `caret` can become, as `spec` completes it. The first word is the program. */
export async function suggest(spec: Spec, line: string, caret: number): Promise<Menu> {
  const { before, word } = wordAt(line, caret);
  let found: CLI.Suggestion[] = [];
  let free: Arg | undefined;
  if (before.length === 0) {
    found = [{ name: spec.name }];
  } else if (before[0].text === spec.name) {
    const argv = before.slice(1).map((w) => w.text);
    found = await CLI.complete(spec, argv, word.text);
    free = freeArgument(await readNext(spec, argv, word.text));
  }
  const items: Item[] = [];
  for (const { name, description, incomplete } of found) {
    const names = asArray(name);
    const matching = names.filter((n) => n.startsWith(word.text));
    if (matching.length > 0) {
      const insert = matching.reduce((a, b) => (b.length > a.length ? b : a));
      items.push({ names, insert, description, incomplete });
    }
  }
  // Text typed for an argument that takes any text is meant, so it comes
  // first, and accepting keeps it. Tab still completes from the rest.
  if (free && word.text !== "" && !items.some((item) => item.insert === word.text)) {
    items.unshift({ names: [word.text], insert: word.text, typed: free.name ?? "value" });
  }
  return { word, items, selected: -1 };
}

/** The argument the word fills, if it takes any text: one with no parser. */
function freeArgument(next: Awaited<ReturnType<typeof readNext>>): Arg | undefined {
  if (next.partialIsOption && !next.attached) {
    return undefined;
  }
  const arg = next.attached ? next.attached.arg : next.value ? next.value.arg : next.arg;
  return arg && arg.parse === undefined ? arg : undefined;
}

/** The item that accepting takes: the selected one, or else the first. */
export function current(menu: Menu): Item | undefined {
  return menu.items[Math.max(menu.selected, 0)];
}

/** The rest of the current item after what's typed of the word, shown after the caret. */
export function preview(menu: Menu): string {
  const insert = current(menu)?.insert ?? "";
  return insert.startsWith(menu.word.text) ? insert.slice(menu.word.text.length) : "";
}

/** `menu` with the selection moved by `by`, wrapping around. From no selection, forward is the first. */
export function move(menu: Menu, by: number): Menu {
  const count = menu.items.length;
  const from = menu.selected < 0 && by > 0 ? -1 : menu.selected < 0 ? 0 : menu.selected;
  return { ...menu, selected: (from + by + count) % count };
}

/** `line` with the word replaced by `item`, followed by a space unless it's incomplete. */
export function accept(line: string, caret: number, menu: Menu, item = current(menu)): Edit {
  if (!item) {
    return { line, caret };
  }
  const insert = item.insert + (item.incomplete ? "" : " ");
  return {
    line: line.slice(0, menu.word.start) + insert + line.slice(caret),
    caret: menu.word.start + insert.length,
  };
}

/** What the items' inserts all start with. */
function sharedStart(items: Item[]): string {
  let shared = items[0]?.insert ?? "";
  for (const { insert } of items) {
    while (!insert.startsWith(shared)) {
      shared = shared.slice(0, -1);
    }
  }
  return shared;
}

/**
 * What Tab does. With one item, or one suggested besides the word as typed,
 * it's accepted. Before an item is selected, the word is completed as far as
 * the suggestions agree, like bash and zsh do. Once that adds nothing, Tab
 * moves to the next item, like fish.
 */
export function tab(line: string, caret: number, menu: Menu): Edit | Menu {
  if (menu.items.length === 1) {
    return accept(line, caret, menu);
  }
  const suggested = menu.items.filter((item) => item.typed === undefined);
  if (menu.selected < 0 && suggested.length === 1) {
    return accept(line, caret, menu, suggested[0]);
  }
  const shared = sharedStart(suggested);
  if (menu.selected < 0 && shared.length > menu.word.text.length) {
    return {
      line: line.slice(0, menu.word.start) + shared + line.slice(caret),
      caret: menu.word.start + shared.length,
    };
  }
  return move(menu, 1);
}

/** Whether the menu offers anything that isn't typed already. */
export function offersMore(menu: Menu): boolean {
  return menu.items.length > 1 || (menu.items.length === 1 && menu.items[0].insert !== menu.word.text);
}
