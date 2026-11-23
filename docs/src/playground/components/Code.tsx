import { For } from "solid-js";
import { hintScroll } from "@/lib/scroll-hint";

export interface SourceFile {
  path: string;
  /** Each line, highlighted. */
  code: readonly string[];
}

/** The last part of `path`. */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A scenario's source, a file at a time, with the lines that are lit. Another file with lines lit is marked. */
export function Code(props: {
  files: readonly SourceFile[];
  shown: string;
  lit: Map<string, Set<number>>;
  /** What the lit lines are for, whose colour they take. */
  kind?: string;
  onShow: (path: string) => void;
  onHoverLine: (at: { file: string; line: number } | null) => void;
}) {
  const file = () => props.files.find((f) => f.path === props.shown) ?? props.files[0];
  const active = () => props.lit.get(file().path) ?? new Set<number>();
  return (
    <div class="code" data-kind={props.kind}>
      <div class="files" role="tablist" ref={hintScroll}>
        <For each={props.files}>
          {(f) => (
            <button
              role="tab"
              aria-selected={f.path === file().path ? "true" : "false"}
              class={{ lit: f.path !== file().path && (props.lit.get(f.path)?.size ?? 0) > 0 }}
              onClick={() => props.onShow(f.path)}
            >
              {fileName(f.path)}
            </button>
          )}
        </For>
      </div>
      <pre
        ref={hintScroll}
        onMouseOver={(event) => {
          const n = (event.target as Element).closest<HTMLElement>("[data-n]")?.dataset.n;
          props.onHoverLine(n ? { file: file().path, line: Number(n) } : null);
        }}
        onMouseLeave={() => props.onHoverLine(null)}
      >
        <code>
          <For each={file().code}>
            {(line, i) => (
              <span
                class="line"
                data-n={i() + 1}
                data-active={active().has(i() + 1) || undefined}
                innerHTML={line}
              />
            )}
          </For>
        </code>
      </pre>
    </div>
  );
}
