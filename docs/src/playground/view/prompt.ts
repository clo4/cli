import type { Token } from "../analyse";
import type { Menu } from "../menu";
import { html, type Html } from "./html";

/**
 * The command line: an input, with a mirror of its text behind it that marks
 * each word, and the card and menu that open under it.
 */
export class Prompt {
  readonly input: HTMLInputElement;
  private readonly mirror: HTMLElement;
  private readonly box: HTMLElement;
  private charWidth = 0;

  constructor(root: HTMLElement) {
    this.input = root.querySelector<HTMLInputElement>("[data-input]")!;
    this.mirror = root.querySelector<HTMLElement>("[data-mirror]")!;
    this.box = root.querySelector<HTMLElement>("[data-cmd]")!;
    this.input.addEventListener("scroll", () => this.syncScroll());
    new ResizeObserver(() => this.markOverflow()).observe(this.input);
  }

  get line(): string {
    return this.input.value;
  }

  set line(line: string) {
    this.input.value = line;
  }

  get caret(): number {
    return this.input.selectionStart ?? 0;
  }

  set caret(at: number) {
    this.input.setSelectionRange(at, at);
  }

  get focused(): boolean {
    return document.activeElement === this.input;
  }

  /** Measures a character, which needs the font loaded. */
  measure() {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(50);
    this.mirror.append(probe);
    this.charWidth = probe.getBoundingClientRect().width / 50;
    probe.remove();
  }

  /** Marks each word of the line, and the part of it a problem is about. */
  render(tokens: Token[]) {
    const line = this.line;
    const parts: (string | Html)[] = [];
    let last = 0;
    tokens.forEach((token, i) => {
      parts.push(line.slice(last, token.start));
      const text = line.slice(token.start, token.end);
      const start = token.problems.find((p) => p.start !== undefined)?.start;
      // A problem's start is in the word's text, which can be shorter than
      // what's typed, so it's counted from the end.
      const split = start === undefined ? text.length : text.length - (token.text.length - start);
      const body =
        start === undefined
          ? text
          : html`${text.slice(0, split)}<span data-problem>${text.slice(split)}</span>`;
      const whole = token.problems.length > 0 && start === undefined;
      parts.push(html`<span class="tk" data-i="${i}" ${whole ? html`data-problem` : ""}>${body}</span>`);
      last = token.end;
    });
    this.mirror.innerHTML = html`${parts}${line.slice(last)} `.value;
    this.syncScroll();
  }

  /** Highlights the words at `indexes`. */
  activate(indexes: Set<number>) {
    for (const span of this.mirror.querySelectorAll<HTMLElement>(".tk")) {
      span.toggleAttribute("data-active", indexes.has(Number(span.dataset.i)));
    }
  }

  /** The index of the word under `clientX`, or -1. */
  tokenAt(clientX: number, tokens: Token[]): number {
    if (!this.charWidth) {
      return -1;
    }
    const left = this.input.getBoundingClientRect().left + this.padLeft() - this.input.scrollLeft;
    const c = Math.floor((clientX - left) / this.charWidth);
    return tokens.findIndex((t) => t.start <= c && c < t.end);
  }

  showCard(index: number, body: Html | null) {
    const existing = this.box.querySelector<HTMLElement>(".card");
    if (!body) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.i === String(index) && existing.innerHTML === body.value) {
      return;
    }
    existing?.remove();
    const card = this.pop("pop card", this.wordLeft(index));
    card.dataset.i = String(index);
    card.innerHTML = body.value;
    this.place(card);
  }

  showMenu(menu: Menu | null) {
    this.box.querySelector(".completions")?.remove();
    if (!menu || menu.items.length === 0) {
      return;
    }
    this.box.querySelector(".card")?.remove();
    const box = this.pop("pop completions", this.charLeft(menu.word.start));
    box.setAttribute("role", "listbox");
    box.innerHTML = html`${menu.items.map(
      (item, i) =>
        html`<div role="option" aria-selected="${i === menu.selected}">
          <code>${item.names.join(", ")}</code>${
            item.description ? html`<span>${item.description}</span>` : ""
          }
        </div>`,
    )}`.value;
    this.place(box);
  }

  /** Selects the menu's item at `index`. */
  select(index: number) {
    this.box
      .querySelectorAll(".completions [role=option]")
      .forEach((el, i) => el.setAttribute("aria-selected", String(i === index)));
  }

  /** The index of the menu item at `target`, if it's one. */
  itemAt(target: EventTarget | null): number {
    const option = (target as Element | null)?.closest(".completions [role=option]");
    return option ? [...option.parentElement!.children].indexOf(option) : -1;
  }

  private pop(className: string, left: number): HTMLElement {
    const el = document.createElement("div");
    el.className = className;
    el.style.left = `${left}px`;
    this.box.append(el);
    return el;
  }

  /** Moves `el` left until it fits in the prompt. */
  private place(el: HTMLElement) {
    const room = this.box.clientWidth - el.offsetWidth;
    if (el.offsetLeft > room) {
      el.style.left = `${Math.max(0, room)}px`;
    }
  }

  private padLeft() {
    return parseFloat(getComputedStyle(this.input).paddingLeft);
  }

  private wordLeft(index: number) {
    const span = this.mirror.querySelector<HTMLElement>(`[data-i="${index}"]`);
    return span ? span.offsetLeft - this.mirror.scrollLeft : 0;
  }

  private charLeft(at: number) {
    return this.padLeft() + at * this.charWidth - this.input.scrollLeft;
  }

  private syncScroll() {
    this.mirror.scrollLeft = this.input.scrollLeft;
    this.markOverflow();
  }

  private markOverflow() {
    const { scrollLeft, clientWidth, scrollWidth } = this.input;
    this.box.toggleAttribute("data-more-text", scrollLeft + clientWidth < scrollWidth - 1);
  }
}
