import type { Printed, Problem, Token } from "../analyse";
import type { ActionInput } from "../inputs";
import type { Copy } from "./copy";
import { fill, html, type Html } from "./html";

/** What the command printed, with its error lines marked. */
export function terminal(printed: Printed[]): Html {
  const lines = printed.flatMap(({ fd, text }) => text.split(/(?<=\n)/).map((line) => ({ fd, line })));
  return html`${lines.map(({ fd, line }) =>
    fd === 2 && line.startsWith("Error: ") ? html`<span class="stderr">${line}</span>` : line,
  )}`;
}

function show(value: unknown): Html {
  if (value === undefined) {
    return html`<span class="ty">undefined</span>`;
  }
  const type = Array.isArray(value) ? "array" : typeof value;
  const text = typeof value === "number" ? String(value) : JSON.stringify(value);
  return html`${text} <span class="ty">${type}</span>`;
}

/** The panel beside the output: the line's problems, or what the action gets. */
export function inspector(
  input: ActionInput | null,
  problems: Problem[],
  tokens: Token[],
  copy: Copy,
): { title: string; body: Html } {
  if (problems.length) {
    return {
      title: copy.problems,
      body: html`${problems.map((p) => {
        const token = p.token === undefined ? undefined : tokens[p.token];
        const where = token ? (p.start === undefined ? token.text : token.text.slice(p.start)) : "";
        return html`<div class="problem"><b>${where}</b><span>${p.message}</span></div>`;
      })}`,
    };
  }
  if (!input) {
    return { title: copy.result, body: html`` };
  }
  if (input.kind === "replaced") {
    return {
      title: copy.result,
      body: html`<p class="note">
        ${fill(copy.optionAction, { option: html`<code>${input.option}</code>` })}
      </p>`,
    };
  }
  const rows = [
    ...input.args.map(
      ({ name, value }) =>
        html`<dt>${name}</dt>
          <dd>${show(value)}</dd>`,
    ),
    ...input.options.map(({ name, read, value, isDefault }) =>
      read === "get"
        ? html`<dt class="${isDefault ? "default" : ""}">${name}</dt>
            <dd class="${isDefault ? "default" : ""}">${show(value)}</dd>`
        : html`<dt>${name}</dt>
            <dd>${String(value)} <span class="ty">${read}()</span></dd>`,
    ),
  ];
  return { title: copy.result, body: html`<dl class="kv">${rows}</dl>` };
}
