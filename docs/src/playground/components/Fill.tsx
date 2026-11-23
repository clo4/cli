import { For } from "solid-js";
import type { JSX } from "@solidjs/web";

/** `text` with each `{name}` replaced by its element. */
export function Fill(props: { text: string; vars: Record<string, JSX.Element> }) {
  return (
    <For each={props.text.split(/(\{\w+\})/)}>
      {(part) => (/^\{\w+\}$/.test(part) ? props.vars[part.slice(1, -1)] : part)}
    </For>
  );
}
