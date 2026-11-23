import { For, Match, Switch } from "solid-js";
import type { JSX } from "@solidjs/web";

/** A value as it'd be written in TypeScript, coloured like the source, with its type, or what reads it, after it. */
export function Value(props: { value: unknown; read?: string }) {
  return (
    <>
      <Literal value={props.value} />
      <span class="ty"> {props.read ?? typeOf(props.value)}</span>
    </>
  );
}

function typeOf(value: unknown) {
  return Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
}

function Literal(props: { value: unknown }): JSX.Element {
  return (
    <Switch fallback={<span class="v-other">{String(props.value)}</span>}>
      <Match when={typeof props.value === "string"}>
        <span class="v-string">{JSON.stringify(props.value)}</span>
      </Match>
      <Match when={typeof props.value === "number" || typeof props.value === "boolean"}>
        <span class="v-constant">{String(props.value)}</span>
      </Match>
      <Match when={Array.isArray(props.value) && (props.value as unknown[])}>
        {(items) => (
          <>
            [
            <For each={items()}>
              {(item, i) => (
                <>
                  {i() > 0 && ", "}
                  <Literal value={item} />
                </>
              )}
            </For>
            ]
          </>
        )}
      </Match>
      <Match
        when={
          typeof props.value === "object" && props.value !== null && (props.value as Record<string, unknown>)
        }
      >
        {(object) => (
          <>
            {"{ "}
            <For each={Object.entries(object())}>
              {([key, item], i) => (
                <>
                  {i() > 0 && ", "}
                  <span class="v-key">{key}</span>: <Literal value={item} />
                </>
              )}
            </For>
            {" }"}
          </>
        )}
      </Match>
    </Switch>
  );
}
