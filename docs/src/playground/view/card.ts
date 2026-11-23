import type { Arg, Option, Subcommand } from "@clo4/cli";
import type { Token } from "../analyse";
import type { Piece, SpecTree } from "../tree";
import { asArray, keyOf, names } from "../util";
import type { Copy } from "./copy";
import { fill, html, type Html } from "./html";

/** The card shown over a word: what it is, where it's declared, and what's wrong with it. */
export function card(token: Token, tree: SpecTree, file: string, copy: Copy): Html | null {
  if (token.problems.length) {
    return html`${token.problems.map((p) => html`<div class="problem-text">${p.message}</div>`)}`;
  }
  const where = (piece: Piece) => {
    const lines = tree.node(piece)?.lines;
    return lines ? ` · ${file}:${lines[0]}` : "";
  };
  const description = (piece: Piece) =>
    "description" in piece && piece.description ? html`<div>${piece.description}</div>` : "";
  const piece = token.pieces[0];
  switch (token.kind) {
    case "program":
      return piece
        ? html`<div class="kind">${copy.program}${where(piece)}</div>
            <code>${token.text}</code>${description(piece)}`
        : null;
    case "subcommand":
      return html`<div class="kind">${copy.subcommand}${where(piece)}</div>
        <code>${names(piece as Subcommand)[0]}</code>${description(piece)}`;
    case "option":
      return html`${[...new Set(token.pieces)].map((option) => {
        const times = token.pieces.filter((p) => p === option).length;
        return html`<div class="kind">${copy.option}${where(option)}${times > 1 ? ` · ×${times}` : ""}</div>
          ${names(option as Option).map((name) => html`<code>${name}</code>`)}${description(option)}`;
      })}`;
    case "value": {
      const option = piece as Option;
      return html`<div class="kind">
          ${fill(copy.value, { name: html`<code>${keyOf(option)}</code>` })}${where(option)}
        </div>
        <code>&lt;${asArray(option.args)[0]?.name ?? "value"}&gt;</code>`;
    }
    case "argument":
      return piece
        ? html`<div class="kind">${copy.argument}${where(piece)}</div>
            <code>&lt;${(piece as Arg).name ?? ""}&gt;</code>${description(piece)}`
        : null;
    case "separator":
      return html`<div class="kind">${copy.separator}</div>
        <code>--</code>`;
    default:
      return null;
  }
}
