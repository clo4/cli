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

/** What the page works out for each scenario as it's built. */
export interface Panel {
  /** The tab's name. */
  tab: string;
  /** Each line of the source, highlighted. */
  code: string[];
  ranges: Ranges;
}

export interface PlaygroundProps {
  panels: Record<string, Panel>;
  copy: Copy;
}

export function Playground(props: PlaygroundProps) {
  const ranges = Object.fromEntries(Object.entries(props.panels).map(([id, panel]) => [id, panel.ranges]));
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
              {props.panels[scenario.id].tab}
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
              file={`${id}.ts`}
              lines={props.panels[id].code}
              active={pg.highlight().lines}
              kind={pg.highlight().kind}
              onHoverLine={(line) => pg.hoverLine(line)}
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
