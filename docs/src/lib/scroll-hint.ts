function mark(element: Element) {
  const more = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
  element.toggleAttribute("data-more", more);
}

export function hintScroll(element: Element) {
  mark(element);
  element.addEventListener("scroll", () => mark(element), { passive: true });
  new ResizeObserver(() => mark(element)).observe(element);
}

export function hintScrollAll(selector: string, root: ParentNode = document) {
  for (const element of root.querySelectorAll(selector)) {
    hintScroll(element);
  }
}
