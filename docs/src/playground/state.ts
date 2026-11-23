/**
 * The playground's state: a few signals for what the user does, and what
 * follows from them. The views read it, and call its actions.
 */

import { createDeferred, createMemo, createSignal, onCleanup } from "solid-js";
import { analyse, type Analysis, type Kind, type Token } from "./analyse";
import { actionInput } from "./inputs";
import * as menus from "./menu";
import type { Ranges } from "./ranges";
import { scenarios } from "./scenarios";
import { specTree } from "./tree";
import { words } from "./words";

export type Playground = ReturnType<typeof createPlayground>;

/** What lights up: words of the line, lines of source, and the word whose card is open. */
export interface Highlight {
  tokens: Set<number>;
  lines: Set<number>;
  card: number;
  /** What the word in focus is, which the lines it lights take the colour of. */
  kind?: Kind;
}

/** A media query's match, as a signal. */
function matches(query: string) {
  const list = matchMedia(query);
  const [matched, setMatched] = createSignal(list.matches);
  const change = () => setMatched(list.matches);
  list.addEventListener("change", change);
  onCleanup(() => list.removeEventListener("change", change));
  return matched;
}

const unread = (line: string): Token[] =>
  words(line).map((word) => ({ ...word, kind: "unread", pieces: [], problems: [] }));

export function createPlayground(ranges: Record<string, Ranges>, notFound: string) {
  const [id, setId] = createSignal(scenarios[0].id);
  const scenario = createMemo(() => scenarios.find((s) => s.id === id())!);
  const tree = createMemo(() => specTree(scenario().spec, ranges[id()]));

  const [line, setLine] = createSignal(scenario().line);
  const [caret, setCaret] = createSignal(line().length);
  /** Counts the changes to the line that the input didn't make, which it then shows. */
  const [revision, setRevision] = createSignal(0);
  const [focused, setFocused] = createSignal(false);
  /** The word under the pointer, or -1. */
  const [hovered, setHovered] = createSignal(-1);
  /** The line of source under the pointer. */
  const [hoveredLine, setHoveredLine] = createSignal<number | null>(null);
  /** On a touch screen, the card opens once the line is tapped. */
  const [tapped, setTapped] = createSignal(false);
  const coarse = matches("(pointer: coarse)");

  // The analysis lags the line by as long as reading it takes. Until it
  // lands, the words that haven't changed keep what it said about them.
  const analysis = createDeferred<Analysis>(
    () => analyse(scenario().spec, line(), (name) => notFound.replace("{name}", name)),
    { loadingValue: { tokens: [], problems: [], result: null, printed: [] } },
  );
  const tokens = createMemo(() => {
    const known = analysis().tokens;
    return unread(line()).map(
      (word) => known.find((t) => t.start === word.start && t.text === word.text) ?? word,
    );
  });
  const input = createMemo(() => actionInput(analysis()));

  const suggestions = createDeferred<menus.Menu | null>(
    () => (focused() ? menus.suggest(scenario().spec, line(), caret()) : null),
    { loadingValue: null },
  );
  /** The selected item, until the suggestions change. */
  const [selected, setSelected] = createSignal(() => {
    suggestions();
    return -1;
  });
  /** Escape closes the menu until the line changes. */
  const [dismissed, setDismissed] = createSignal(() => {
    line();
    return false;
  });
  const menu = createMemo(() => {
    const found = suggestions();
    return found && { ...found, selected: selected() };
  });
  const shownMenu = createMemo(() => {
    const m = menu();
    return m && !dismissed() && menus.offersMore(m) ? m : null;
  });
  const preview = createMemo(() => {
    const m = shownMenu();
    return m && caret() === line().length ? menus.preview(m) : "";
  });

  const highlight = createMemo((): Highlight => {
    const lit: Highlight = { tokens: new Set(), lines: new Set(), card: -1 };
    const addLines = (lines: [number, number] | undefined) => {
      for (let l = lines?.[0] ?? 1; lines && l <= lines[1]; l++) {
        lit.lines.add(l);
      }
    };
    const all = tokens();
    const source = hoveredLine();
    if (source !== null) {
      // A piece that no word is, like an argument not typed yet, lights up as
      // the piece it's declared in.
      for (let node = tree().at(source); node && lit.tokens.size === 0; node = node.parent) {
        all.forEach((t, i) => t.pieces.includes(node!.piece) && lit.tokens.add(i));
        if (lit.tokens.size) {
          addLines(node.lines);
          lit.kind = all[[...lit.tokens][0]].kind;
        }
      }
      return lit;
    }
    const at = caret();
    const i =
      hovered() >= 0 ? hovered() : focused() ? all.findIndex((t) => t.start <= at && at <= t.end) : -1;
    if (i < 0) {
      return lit;
    }
    lit.tokens.add(i);
    lit.kind = all[i].kind;
    for (const piece of all[i].pieces) {
      addLines(tree().node(piece)?.lines);
    }
    const quiet = coarse() && !tapped() && hovered() < 0;
    lit.card = quiet || shownMenu() ? -1 : i;
    return lit;
  });

  /** Puts `edit` on the line, as if typed. */
  function edit({ line: next, caret: at }: menus.Edit) {
    setLine(next);
    setCaret(at);
    setRevision((r) => r + 1);
  }

  /** The menu, if it's for the line as it is. Keys act on it alone. */
  const current = () => {
    const m = menu();
    return m && m.word.end <= line().length && line().slice(m.word.start, m.word.end) === m.word.text
      ? m
      : null;
  };

  return {
    id,
    scenario,
    tree,
    line,
    caret,
    revision,
    focused,
    tokens,
    analysis,
    input,
    menu: shownMenu,
    preview,
    highlight,

    show(next: string) {
      const { line } = scenarios.find((s) => s.id === next)!;
      setId(next);
      edit({ line, caret: line.length });
    },
    run(next: string) {
      edit({ line: next, caret: next.length });
    },
    typed(next: string, at: number) {
      setLine(next);
      setCaret(at);
      setTapped(false);
    },
    moved(at: number) {
      setCaret(at);
    },
    tapped() {
      setTapped(true);
    },
    focus(on: boolean) {
      setFocused(on);
    },
    hover(index: number) {
      setHovered(index);
    },
    hoverLine(n: number | null) {
      setHoveredLine(n);
    },

    /** Tab: completes as far as the items agree, then moves through them. */
    tab(): boolean {
      const m = current();
      if (!m || m.items.length === 0) {
        return false;
      }
      setDismissed(false);
      const done = menus.tab(line(), caret(), m);
      if ("items" in done) {
        setSelected(done.selected);
      } else {
        edit(done);
      }
      return true;
    },
    /** Moves the selection, while the menu is open. */
    move(by: number): boolean {
      const m = shownMenu();
      if (!m) {
        return false;
      }
      setSelected(menus.move(m, by).selected);
      return true;
    },
    /** Accepts the item at `index`, or the current one. */
    accept(index?: number): boolean {
      const m = current();
      if (!m || !shownMenu()) {
        return false;
      }
      edit(menus.accept(line(), caret(), m, index === undefined ? undefined : m.items[index]));
      return true;
    },
    dismiss(): boolean {
      if (!shownMenu()) {
        return false;
      }
      setDismissed(true);
      return true;
    },
    open() {
      setDismissed(false);
    },
  };
}
