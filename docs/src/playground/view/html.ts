/** Markup, which {@link html} puts in as it is. */
export class Html {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function render(value: unknown): string {
  if (value instanceof Html) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(render).join("");
  }
  if (value === undefined || value === null || value === false) {
    return "";
  }
  return escape(String(value));
}

/** Markup with each value escaped, unless it's markup itself. Arrays are joined, and nothing, null and false are left out. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Html {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Html(out);
}

/** `text` with each `{name}` replaced by its markup. */
export function fill(text: string, vars: Record<string, Html>): Html {
  return new Html(escape(text).replace(/\{(\w+)\}/g, (_, name: string) => vars[name]?.value ?? ""));
}
