/**
 * The completion menu, as a shell's: it offers what the word at the caret can
 * become, Tab completes as far as the items agree and then moves through them,
 * and accepting one opens the menu for the next word.
 */

import * as CLI from "@clo4/cli";
import type { Spec } from "@clo4/cli";
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
  let found: CLI.Suggestion[];
  if (before.length === 0) {
    found = [{ name: spec.name }];
  } else if (before[0].text !== spec.name) {
    found = [];
  } else {
    found = await CLI.complete(
      spec,
      before.slice(1).map((w) => w.text),
      word.text,
    );
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
  return { word, items, selected: -1 };
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
 * What Tab does. With one item, it's accepted. Before an item is selected, the
 * word is completed as far as the items agree, like bash and zsh do. Once that
 * adds nothing, Tab moves to the next item, like fish.
 */
export function tab(line: string, caret: number, menu: Menu): Edit | Menu {
  if (menu.items.length === 1) {
    return accept(line, caret, menu);
  }
  const shared = sharedStart(menu.items);
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
