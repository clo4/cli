import { For, Match, Show, Switch } from "solid-js";
import type { Problem, Token } from "../analyse";
import type { ActionInput } from "../inputs";
import type { Copy } from "../copy";
import { Value } from "./Value";
import { hintScroll } from "@/lib/scroll-hint";
import { Fill } from "./Fill";

/** The line's problems, or else what the action gets: its arguments by position, and its options by name. */
export function Inspector(props: {
  input: ActionInput | null;
  problems: readonly Problem[];
  tokens: readonly Token[];
  copy: Copy;
}) {
  const where = (problem: Problem) => {
    const token = problem.token === undefined ? undefined : props.tokens[problem.token];
    if (!token) {
      return "";
    }
    return problem.start === undefined ? token.text : token.text.slice(problem.start);
  };
  return (
    <section class="inspector">
      <h2>
        {props.problems.length ? props.copy.problems : props.copy.result}
        <Show when={!props.problems.length && props.input?.kind === "input" && props.input}>
          {(input) => <code class="path">{input().path.join(" ")}</code>}
        </Show>
      </h2>
      <div class="out" ref={hintScroll}>
        <Switch>
          <Match when={props.problems.length}>
            <For each={props.problems}>
              {(problem) => (
                <div class="problem">
                  <b>{where(problem)}</b>
                  <span>{problem.message}</span>
                </div>
              )}
            </For>
          </Match>
          <Match when={props.input?.kind === "replaced" && props.input}>
            {(input) => (
              <p class="note">
                <Fill text={props.copy.optionAction} vars={{ option: <code>{input().option}</code> }} />
              </p>
            )}
          </Match>
          <Match when={props.input?.kind === "input" && props.input}>
            {(input) => (
              <>
                <Show when={input().args.length}>
                  <h3>args</h3>
                  <dl>
                    <For each={input().args}>
                      {(arg, i) => (
                        <>
                          <dt>
                            <span class="index">{i()}</span>
                            {arg.name}
                          </dt>
                          <dd>
                            <Value value={arg.value} />
                          </dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
                <Show when={input().options.length}>
                  <h3>options</h3>
                  <dl>
                    <For each={input().options}>
                      {(option) => (
                        <>
                          <dt class={{ default: option.isDefault && option.read === "get" }}>
                            {option.name}
                          </dt>
                          <dd class={{ default: option.isDefault && option.read === "get" }}>
                            <Value
                              value={option.value}
                              read={option.read === "get" ? undefined : `${option.read}()`}
                            />
                          </dd>
                        </>
                      )}
                    </For>
                  </dl>
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}
