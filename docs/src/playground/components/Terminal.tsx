import { For } from "solid-js";
import type { Printed } from "../analyse";
import { hintScroll } from "@/lib/scroll-hint";

/** What the command printed, with its error lines marked. */
export function Terminal(props: { printed: readonly Printed[] }) {
  const lines = () =>
    props.printed.flatMap(({ fd, text }) =>
      text.split(/(?<=\n)/).map((line) => ({ line, error: fd === 2 && line.startsWith("Error: ") })),
    );
  return (
    <pre class="terminal" ref={hintScroll}>
      <For each={lines()}>{({ line, error }) => (error ? <span class="stderr">{line}</span> : line)}</For>
    </pre>
  );
}
