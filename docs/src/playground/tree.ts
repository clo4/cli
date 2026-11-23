import type { Arg, Option, Spec, Subcommand } from "@clo4/cli";
import type { Ranges } from "./ranges";
import { asArray, names } from "./util";

/** A part of a spec that a word of the line can be, or that a line of its source declares. */
export type Piece = Spec | Subcommand | Option | Arg;

export interface Node {
  piece: Piece;
  /** The file that declares it. */
  file: string;
  /** The piece it's declared in. */
  parent?: Node;
  /** The lines of the file that declare it. */
  lines?: [from: number, to: number];
}

/** A file's spec or command, and the lines of each of its pieces. */
export interface Root {
  file: string;
  piece: Spec | Subcommand;
  ranges: Ranges;
}

export interface SpecTree {
  /**
   * Where `piece` is declared. A command loaded on demand is declared twice:
   * in the file it's loaded from, which comes first, and by its loading
   * definition.
   */
  nodes(piece: Piece): Node[];
  /** The innermost piece `file` declares on `line`. */
  at(file: string, line: number): Node | undefined;
}

type Command = Spec | Subcommand;

const isCommand = (piece: Piece): piece is Command =>
  "subcommands" in piece || "action" in piece || "loadSpec" in piece || "requiresSubcommand" in piece;

/** Whether `copy` is `command` with other metadata, as the parser makes of a loaded command. */
const copies = (copy: Command, command: Command) =>
  (["subcommands", "options", "args", "action"] as const).some(
    (key) => command[key] !== undefined && copy[key] === command[key],
  );

/**
 * Each piece of each file, with the lines that declare it, as
 * {@link specRanges} found them. The first file has the spec, and the others
 * the commands it loads.
 */
export function specTree(roots: readonly Root[]): SpecTree {
  const nodes = new Map<Piece, Node>();
  const commands: Node[] = [];
  function add(piece: Piece, file: string, lines: Ranges[string] | undefined, parent?: Node): Node {
    const node: Node = { piece, file, parent, lines };
    nodes.set(piece, node);
    return node;
  }
  function walk(file: string, ranges: Ranges, command: Command, path: string, parent?: Node) {
    const node = add(command, file, ranges[path], parent);
    commands.push(node);
    asArray(command.args).forEach((arg, i) => add(arg, file, ranges[`${path}.args.${i}`], node));
    asArray(command.options).forEach((option, i) => {
      const at = `${path}.options.${i}`;
      const optionNode = add(option, file, ranges[at], node);
      asArray(option.args).forEach((arg, j) => add(arg, file, ranges[`${at}.args.${j}`], optionNode));
    });
    asArray(command.subcommands).forEach((sub, i) =>
      walk(file, ranges, sub, `${path}.subcommands.${i}`, node),
    );
  }
  for (const root of roots) {
    walk(root.file, root.ranges, root.piece, "spec");
  }

  return {
    nodes(piece) {
      const node = nodes.get(piece);
      if (!isCommand(piece)) {
        return node ? [node] : [];
      }
      // A command loaded on demand is declared by its loading definition, and
      // as the root of the file it's loaded from. The parser reads the
      // loading definition until it enters the command, and then a copy of
      // what's loaded, found by the parts it shares with it.
      const name = names(piece)[0];
      const loading = (n: Node) => "loadSpec" in n.piece && names(n.piece)[0] === name;
      const loaded = (n: Node) =>
        n.parent === undefined && n.piece !== roots[0].piece && names(n.piece)[0] === name;
      if (node && "loadSpec" in piece) {
        return [...commands.filter(loaded), node];
      }
      if (node) {
        return node.parent === undefined && node.piece !== roots[0].piece
          ? [node, ...commands.filter(loading)]
          : [node];
      }
      const copied = commands.filter((n) => copies(piece, n.piece as Command));
      return copied.length ? [...copied, ...commands.filter(loading)] : [];
    },
    at(file, line) {
      let best: Node | undefined;
      for (const node of nodes.values()) {
        const lines = node.lines;
        if (node.file === file && lines && lines[0] <= line && line <= lines[1]) {
          if (!best || lines[1] - lines[0] < best.lines![1] - best.lines![0]) {
            best = node;
          }
        }
      }
      return best;
    },
  };
}
