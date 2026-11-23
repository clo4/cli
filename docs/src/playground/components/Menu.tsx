import { For, Show } from "solid-js";
import type { Menu as MenuState } from "../menu";

/** The completion menu. An item is accepted on press, before the line loses focus. */
export function Menu(props: { menu: MenuState; onAccept: (index: number) => void }) {
  return (
    <div class="completions" role="listbox">
      <For each={props.menu.items}>
        {(item, i) => (
          <div
            role="option"
            aria-selected={i() === props.menu.selected ? "true" : "false"}
            onMouseDown={(event) => {
              event.preventDefault();
              props.onAccept(i());
            }}
          >
            <code>{item.names.join(", ")}</code>
            <Show
              when={item.typed}
              fallback={<Show when={item.description}>{(text) => <span>{text()}</span>}</Show>}
            >
              {(arg) => <span>&lt;{arg()}&gt;</span>}
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}
