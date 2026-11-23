import { createEffect } from "solid-js";
import type { JSX } from "@solidjs/web";

/** A card or menu under the line, at `left` or as near it as fits. */
export function Pop(props: { left: number; class: string; children: JSX.Element }) {
  let el!: HTMLDivElement;
  createEffect(
    () => props.left,
    (left) => {
      const room = el.parentElement!.clientWidth - el.offsetWidth;
      el.style.left = `${Math.max(0, Math.min(left, room))}px`;
    },
  );
  return (
    <div ref={(e) => (el = e)} class={["pop surface", props.class]}>
      {props.children}
    </div>
  );
}
