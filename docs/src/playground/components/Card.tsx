import type { Arg, Option, Subcommand } from "@clo4/cli";
import { For, Match, Show, Switch } from "solid-js";
import type { Token } from "../analyse";
import type { Copy } from "../copy";
import type { Piece, SpecTree } from "../tree";
import { asArray, keyOf, names } from "../util";
import { fileName } from "./Code";
import { Fill } from "./Fill";

/** What a word is, where it's declared, and what's wrong with it. */
export function Card(props: { token: Token; tree: SpecTree; copy: Copy }) {
  const where = (piece: Piece) => {
    const node = props.tree.nodes(piece)[0];
    return node?.lines ? ` · ${fileName(node.file)}:${node.lines[0]}` : "";
  };
  const description = (piece: Piece) => ("description" in piece ? piece.description : undefined);
  const piece = () => props.token.pieces[0];
  const options = () =>
    [...new Set(props.token.pieces)].map((option) => ({
      option: option as Option,
      times: props.token.pieces.filter((p) => p === option).length,
    }));

  return (
    <Switch>
      <Match when={props.token.problems.length}>
        <For each={props.token.problems}>
          {(problem) => <div class="problem-text">{problem.message}</div>}
        </For>
      </Match>
      <Match when={props.token.kind === "program" && piece()}>
        <div class="kind">
          {props.copy.program}
          {where(piece())}
        </div>
        <code>{props.token.text}</code>
        <Description text={description(piece())} />
      </Match>
      <Match when={props.token.kind === "subcommand"}>
        <div class="kind">
          {props.copy.subcommand}
          {where(piece())}
        </div>
        <code>{names(piece() as Subcommand)[0]}</code>
        <Description text={description(piece())} />
      </Match>
      <Match when={props.token.kind === "option"}>
        <For each={options()}>
          {({ option, times }) => (
            <>
              <div class="kind">
                {props.copy.option}
                {where(option)}
                {times > 1 && ` · ×${times}`}
              </div>
              <For each={names(option)}>{(name) => <code>{name}</code>}</For>
              <Description text={option.description} />
            </>
          )}
        </For>
      </Match>
      <Match when={props.token.kind === "value"}>
        <div class="kind">
          <Fill text={props.copy.value} vars={{ name: <code>{keyOf(piece() as Option)}</code> }} />
          {where(piece())}
        </div>
        <code>&lt;{asArray((piece() as Option).args)[0]?.name ?? "value"}&gt;</code>
      </Match>
      <Match when={props.token.kind === "argument" && piece()}>
        <div class="kind">
          {props.copy.argument}
          {where(piece())}
        </div>
        <code>&lt;{(piece() as Arg).name ?? ""}&gt;</code>
        <Description text={description(piece())} />
      </Match>
      <Match when={props.token.kind === "separator"}>
        <div class="kind">{props.copy.separator}</div>
        <code>--</code>
      </Match>
    </Switch>
  );
}

function Description(props: { text: string | undefined }) {
  return (
    <Show when={props.text}>
      <div>{props.text}</div>
    </Show>
  );
}

/** Whether a card has anything to say about `token`. */
export function hasCard(token: Token): boolean {
  return token.problems.length > 0 || token.pieces.length > 0 || token.kind === "separator";
}
