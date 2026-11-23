/**
 * Copies for every `[data-copy]` button on the page: its `data-copy-text`,
 * the text at its `data-copy-url`, or else the code in its `.code-block`. The
 * button is `[data-copied]` for a moment after.
 */

const shown = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

async function textFor(button: HTMLElement): Promise<string> {
  const { copyText, copyUrl } = button.dataset;
  if (copyText !== undefined) {
    return copyText;
  }
  if (copyUrl !== undefined) {
    return (await fetch(copyUrl)).text();
  }
  return button.closest(".code-block")?.querySelector("pre")?.textContent ?? "";
}

document.addEventListener("click", async (event) => {
  const button = (event.target as Element).closest<HTMLElement>("[data-copy]");
  if (!button) {
    return;
  }
  await navigator.clipboard.writeText(await textFor(button));
  clearTimeout(shown.get(button));
  button.toggleAttribute("data-copied", true);
  shown.set(
    button,
    setTimeout(() => button.removeAttribute("data-copied"), 1200),
  );
});
