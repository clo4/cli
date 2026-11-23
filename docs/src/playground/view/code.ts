/** A scenario's source, whose lines light up for the pieces in use. */
export class Code {
  private readonly lines: HTMLElement[];

  constructor(readonly panel: HTMLElement) {
    this.lines = [...panel.querySelectorAll<HTMLElement>(".line")];
  }

  /** The 1-based number of the line `target` is in, if any. */
  lineAt(target: EventTarget | null): number | null {
    const line = (target as Element | null)?.closest<HTMLElement>(".line");
    const i = line ? this.lines.indexOf(line) : -1;
    return i >= 0 ? i + 1 : null;
  }

  activate(lines: Set<number>) {
    this.lines.forEach((line, i) => line.toggleAttribute("data-active", lines.has(i + 1)));
  }
}
