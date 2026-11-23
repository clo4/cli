import { render } from "@solidjs/web";
import { Playground, type PlaygroundProps } from "./components/Playground";

/** Puts the playground in each `[data-playground]`, with the props the page wrote there. */
export function mount() {
  for (const el of document.querySelectorAll<HTMLElement>("[data-playground]")) {
    const props: PlaygroundProps = JSON.parse(el.dataset.playground!);
    el.replaceChildren();
    render(() => <Playground {...props} />, el);
  }
}
