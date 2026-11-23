import { createEffect, For, Show } from "solid-js";
import type { Copy } from "../copy";
import type { Ranges } from "../ranges";
import { scenarios } from "../scenarios";
import { createPlayground } from "../state";
import { Code } from "./Code";
import { Inspector } from "./Inspector";
import { Prompt } from "./Prompt";
import { Terminal } from "./Terminal";
import { hintScroll } from "@/lib/scroll-hint";
import "../playground.css";

/** What the page works out for each file of the scenarios as it's built. */
export interface Source {
  /** Each line, highlighted. */
  code: string[];
  ranges: Ranges;
}

export interface PlaygroundProps {
  /** Each scenario's tab name. */
  tabs: Record<string, string>;
  /** Each file, by its path in `scenarios`. */
  sources: Record<string, Source>;
  copy: Copy;
}

export function Playground(props: PlaygroundProps) {
  const ranges = Object.fromEntries(
    Object.entries(props.sources).map(([path, source]) => [path, source.ranges]),
  );
  const pg = createPlayground(ranges, props.copy.notFound);

  // The underline slides to the selected tab.
  let tabs!: HTMLDivElement;
  let underline!: HTMLSpanElement;
  createEffect(pg.id, () => {
    const tab = tabs.querySelector<HTMLElement>('[aria-selected="true"]')!;
    underline.style.left = `${tab.offsetLeft}px`;
    underline.style.width = `${tab.offsetWidth}px`;
  });

  return (
    <section class="stage" aria-label={props.copy.label}>
      <div
        class="tabs"
        role="tablist"
        ref={(el) => {
          tabs = el;
          hintScroll(el);
        }}
      >
        <For each={scenarios}>
          {(scenario) => (
            <button
              role="tab"
              aria-selected={pg.id() === scenario.id ? "true" : "false"}
              onClick={() => pg.show(scenario.id)}
            >
              {props.tabs[scenario.id]}
            </button>
          )}
        </For>
        <span class="underline" ref={(e) => (underline = e)} />
      </div>
      <div class="prompt">
        <Prompt pg={pg} copy={props.copy} />
        <div class="tries" ref={hintScroll}>
          <For each={pg.scenario().tries}>
            {(line) => (
              <button class="button small mono" onClick={() => pg.run(line)}>
                {line}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="cols">
        {/* Keyed by the scenario, so the source fades in anew. */}
        <Show when={pg.id()} keyed>
          {(id) => (
            <Code
              files={scenarios
                .find((s) => s.id === id)!
                .files.map(({ path }) => ({ path, code: props.sources[path].code }))}
              shown={pg.file()}
              lit={pg.highlight().lines}
              kind={pg.highlight().kind}
              onShow={(path) => pg.showFile(path)}
              onHoverLine={(at) => pg.hoverLine(at)}
            />
          )}
        </Show>
        <div class="side">
          <section>
            <h2>{props.copy.output}</h2>
            <Terminal printed={pg.analysis().printed} />
          </section>
          <Inspector
            input={pg.input()}
            problems={pg.analysis().problems}
            tokens={pg.analysis().tokens}
            copy={props.copy}
          />
        </div>
      </div>
    </section>
  );
}
