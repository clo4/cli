import { createEffect, createMemo, createSignal, For, Show, untrack } from "solid-js";
import type { Copy } from "../copy";
import type { Playground } from "../state";
import { Card, hasCard } from "./Card";
import { Menu } from "./Menu";
import { Pop } from "./Pop";

// Ctrl with n, j, p or k moves through the menu, as in a terminal. Chrome
// keeps Ctrl+N for a new window everywhere but macOS.
const down = (event: KeyboardEvent) =>
  event.key === "ArrowDown" || (event.ctrlKey && (event.key === "n" || event.key === "j"));
const up = (event: KeyboardEvent) =>
  event.key === "ArrowUp" ||
  (event.ctrlKey && (event.key === "p" || event.key === "k")) ||
  (event.key === "Tab" && event.shiftKey);

/**
 * The command line. The input's text is invisible, and a mirror behind it
 * shows the line coloured by what each word is, with the rest of the current
 * suggestion after the caret. The card and menu open under it.
 */
export function Prompt(props: { pg: Playground; copy: Copy }) {
  const pg = props.pg;
  let input!: HTMLInputElement;
  let mirror!: HTMLDivElement;
  const [charWidth, setCharWidth] = createSignal(0);
  const [scroll, setScroll] = createSignal(0);
  const [overflows, setOverflows] = createSignal(false);

  /** Where character `at` of the line is, from the left of the prompt. Its padding is 2ch. */
  const left = (at: number) => (2 + at) * charWidth() - scroll();

  const segments = createMemo(() => {
    const line = pg.line();
    const parts: { text: string; index?: number }[] = [];
    let last = 0;
    pg.tokens().forEach((token, index) => {
      if (token.start > last) {
        parts.push({ text: line.slice(last, token.start) });
      }
      parts.push({ text: line.slice(token.start, token.end), index });
      last = token.end;
    });
    parts.push({ text: line.slice(last) });
    return parts;
  });

  const card = createMemo(() => {
    const i = pg.highlight().card;
    const token = pg.tokens()[i];
    return token && hasCard(token) ? token : null;
  });

  // A change to the line that wasn't typed, like an accepted suggestion, goes into the input.
  createEffect(
    () => {
      pg.revision();
      return { line: untrack(pg.line), caret: untrack(pg.caret) };
    },
    ({ line, caret }) => {
      input.value = line;
      if (document.activeElement === input) {
        input.setSelectionRange(caret, caret);
      }
      onScroll();
    },
  );
  createEffect(scroll, (x) => {
    mirror.scrollLeft = x;
  });

  function measure() {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(50);
    mirror.append(probe);
    setCharWidth(probe.getBoundingClientRect().width / 50);
    probe.remove();
  }

  function onScroll() {
    setScroll(input.scrollLeft);
    setOverflows(input.scrollLeft + input.clientWidth < input.scrollWidth - 1);
  }

  function onKeyDown(event: KeyboardEvent) {
    const atEnd = input.selectionStart === input.value.length;
    let handled = false;
    if (event.key === " " && event.ctrlKey) {
      pg.open();
      handled = true;
    } else if (event.key === "Tab" && !event.shiftKey) {
      handled = pg.tab();
    } else if (up(event)) {
      handled = pg.move(-1);
    } else if (down(event)) {
      handled = pg.move(1);
    } else if (event.key === "Enter") {
      handled = pg.accept();
    } else if (event.key === "Escape") {
      handled = pg.dismiss();
    } else if ((event.key === "ArrowRight" || event.key === "End") && atEnd && pg.preview()) {
      handled = pg.accept();
    }
    if (handled) {
      event.preventDefault();
    }
  }

  const caretMoved = () => pg.moved(input.selectionStart ?? 0);

  return (
    <div class={{ cmd: true, overflows: overflows() }}>
      <div
        class="mirror"
        aria-hidden="true"
        ref={(el) => {
          mirror = el;
          void document.fonts.ready.then(measure);
        }}
      >
        <For each={segments()}>
          {(part) => {
            if (part.index === undefined) {
              return part.text;
            }
            const token = pg.tokens()[part.index];
            const problem = token.problems.find((p) => p.start !== undefined)?.start;
            // A problem's start is in the word's text, which can be shorter
            // than what's typed, so it's counted from the end.
            const split =
              problem === undefined ? part.text.length : part.text.length - (token.text.length - problem);
            return (
              <span
                class={["tk", token.kind]}
                data-active={pg.highlight().tokens.has(part.index) || undefined}
                data-problem={(token.problems.length > 0 && problem === undefined) || undefined}
              >
                {part.text.slice(0, split)}
                <Show when={split < part.text.length}>
                  <span data-problem>{part.text.slice(split)}</span>
                </Show>
              </span>
            );
          }}
        </For>
        <span class="preview">{pg.preview()}</span>{" "}
      </div>
      <input
        ref={(e) => (input = e)}
        spellcheck={false}
        autocomplete="off"
        autocapitalize="off"
        aria-label={props.copy.input}
        onInput={() => pg.typed(input.value, input.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        onKeyUp={caretMoved}
        onSelect={caretMoved}
        onClick={() => {
          caretMoved();
          pg.tapped();
        }}
        onFocus={() => pg.focus(true)}
        onBlur={() => pg.focus(false)}
        onScroll={onScroll}
        onMouseMove={(event) => {
          const at =
            Math.floor((event.clientX - input.getBoundingClientRect().left + scroll()) / charWidth()) - 2;
          pg.hover(charWidth() ? pg.tokens().findIndex((t) => t.start <= at && at < t.end) : -1);
        }}
        onMouseLeave={() => pg.hover(-1)}
      />
      <Show when={pg.menu()}>
        {(menu) => (
          <Pop class="menu" left={left(menu().word.start)}>
            <Menu menu={menu()} onAccept={(i) => pg.accept(i)} />
          </Pop>
        )}
      </Show>
      <Show when={card()}>
        {(token) => (
          <Pop class="card" left={left(token().start)}>
            <Card token={token()} tree={pg.tree()} file={`${pg.id()}.ts`} copy={props.copy} />
          </Pop>
        )}
      </Show>
    </div>
  );
}
