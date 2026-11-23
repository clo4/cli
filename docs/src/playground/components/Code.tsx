import { For } from "solid-js";
import { hintScroll } from "@/lib/scroll-hint";

/** A scenario's source, a line at a time, with the lines in `active` lit. */
export function Code(props: {
  file: string;
  /** Each line's highlighted markup. */
  lines: readonly string[];
  active: Set<number>;
  /** What the lit lines are for, whose colour they take. */
  kind?: string;
  onHoverLine: (line: number | null) => void;
}) {
  return (
    <div class="code" data-kind={props.kind}>
      <div class="file">{props.file}</div>
      <pre
        ref={hintScroll}
        onMouseOver={(event) => {
          const n = (event.target as Element).closest<HTMLElement>("[data-n]")?.dataset.n;
          props.onHoverLine(n ? Number(n) : null);
        }}
        onMouseLeave={() => props.onHoverLine(null)}
      >
        <code>
          <For each={props.lines}>
            {(line, i) => (
              <span
                class="line"
                data-n={i() + 1}
                data-active={props.active.has(i() + 1) || undefined}
                innerHTML={line}
              />
            )}
          </For>
        </code>
      </pre>
    </div>
  );
}
