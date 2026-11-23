import type { Arg, Option, Spec, Subcommand } from "@clo4/cli";
import type { Ranges } from "./ranges";
import { asArray } from "./util";

/** A part of a spec that a word of the line can be, or that a line of its source declares. */
export type Piece = Spec | Subcommand | Option | Arg;

export interface Node {
  piece: Piece;
  /** The piece it's declared in. */
  parent?: Node;
  /** The lines of the scenario's source that declare it. */
  lines?: [from: number, to: number];
}

export interface SpecTree {
  node(piece: Piece): Node | undefined;
  /** The innermost piece declared on `line`. */
  at(line: number): Node | undefined;
}

/** Each piece of `spec`, with the lines of the source that declare it, as {@link specRanges} found them. */
export function specTree(spec: Spec, ranges: Ranges): SpecTree {
  const nodes = new Map<Piece, Node>();
  function add(piece: Piece, path: string, parent?: Node): Node {
    const node: Node = { piece, parent, lines: ranges[path] };
    nodes.set(piece, node);
    return node;
  }
  function walk(command: Spec | Subcommand, path: string, parent?: Node) {
    const node = add(command, path, parent);
    asArray(command.args).forEach((arg, i) => add(arg, `${path}.args.${i}`, node));
    asArray(command.options).forEach((option, i) => {
      const at = `${path}.options.${i}`;
      const optionNode = add(option, at, node);
      asArray(option.args).forEach((arg, j) => add(arg, `${at}.args.${j}`, optionNode));
    });
    asArray(command.subcommands).forEach((sub, i) => walk(sub, `${path}.subcommands.${i}`, node));
  }
  walk(spec, "spec");

  return {
    node: (piece) => nodes.get(piece),
    at(line) {
      let best: Node | undefined;
      for (const node of nodes.values()) {
        const lines = node.lines;
        if (lines && lines[0] <= line && line <= lines[1]) {
          if (!best || lines[1] - lines[0] < best.lines![1] - best.lines![0]) {
            best = node;
          }
        }
      }
      return best;
    },
  };
}
