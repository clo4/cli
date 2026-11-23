import * as CLI from "@clo4/cli";
import type { Spec } from "@clo4/cli";
import { asArray } from "./util";
import { wordAt, type Word } from "./words";

/** A suggestion in the menu. */
export interface Item {
  /** What accepting it puts in place of the word. */
  insert: string;
  /** The names it's shown by. */
  names: readonly string[];
  description?: string;
  /** No space follows it. */
  incomplete?: boolean;
}

/** The completion menu: what the word at the caret can become, and which is selected. */
export interface Menu {
  word: Word;
  items: Item[];
  selected: number;
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
  const items = found.flatMap(({ name, description, incomplete }) =>
    asArray(name)
      .filter((value) => value.startsWith(word.text) && value !== word.text)
      .map((value) => ({ insert: value, names: [value], description, incomplete })),
  );
  return { word, items, selected: 0 };
}

/** `menu` with the selection moved by `by`, wrapping around. */
export function move(menu: Menu, by: number): Menu {
  const count = menu.items.length;
  return { ...menu, selected: (menu.selected + by + count) % count };
}

/** `line` with the word replaced by the selected item, and where the caret goes. */
export function accept(line: string, caret: number, menu: Menu): { line: string; caret: number } {
  const item = menu.items[menu.selected];
  const insert = item.insert + (item.incomplete ? "" : " ");
  return {
    line: line.slice(0, menu.word.start) + insert + line.slice(caret),
    caret: menu.word.start + insert.length,
  };
}
