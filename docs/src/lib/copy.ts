const copyIcon =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
const checkIcon =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

import { hintScroll, hintScrollAll } from "./scroll-hint";

export function addCopyButtons() {
  for (const prose of document.querySelectorAll<HTMLElement>("[data-copy-label]")) {
    hintScrollAll("table", prose);
    for (const pre of prose.querySelectorAll("pre")) {
      const button = document.createElement("button");
      button.className = "icon-button copy-code";
      button.setAttribute("aria-label", prose.dataset.copyLabel!);
      button.innerHTML = copyIcon;
      button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(pre.querySelector("code")?.textContent ?? pre.textContent ?? "");
        button.innerHTML = checkIcon;
        button.setAttribute("aria-label", prose.dataset.copiedLabel!);
        setTimeout(() => {
          button.innerHTML = copyIcon;
          button.setAttribute("aria-label", prose.dataset.copyLabel!);
        }, 1200);
      });
      const wrap = document.createElement("div");
      wrap.className = "code-block";
      pre.replaceWith(wrap);
      wrap.append(pre, button);
      hintScroll(pre);
    }
  }
}
