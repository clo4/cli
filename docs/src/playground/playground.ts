import { hintScroll, hintScrollAll } from "@/lib/scroll-hint";
import { analyse, type Analysis } from "./analyse";
import { actionInput } from "./inputs";
import { accept, move, suggest, type Menu } from "./menu";
import type { Ranges } from "./ranges";
import { scenarios, type Scenario } from "./scenarios";
import { specTree, type SpecTree } from "./tree";
import { wordAt } from "./words";
import { card } from "./view/card";
import { Code } from "./view/code";
import type { Copy } from "./view/copy";
import { inspector, terminal } from "./view/output";
import { Prompt } from "./view/prompt";

/** Runs the playground in `stage`, as `Stage.astro` lays it out. */
export function start(stage: HTMLElement) {
  const copy: Copy = JSON.parse(stage.dataset.copy!);
  const prompt = new Prompt(stage);
  const out = stage.querySelector<HTMLElement>("[data-out]")!;
  const outTitle = stage.querySelector<HTMLElement>("[data-out-title]")!;
  const printed = stage.querySelector<HTMLElement>("[data-terminal]")!;
  const coarse = matchMedia("(pointer: coarse)");

  let scenario: Scenario;
  let tree: SpecTree;
  let code: Code;
  let analysis: Analysis = { tokens: [], problems: [], result: null, printed: [] };
  let menu: Menu | null = null;
  /** The word under the pointer, or -1. */
  let hovered = -1;
  /** The line of source under the pointer. */
  let hoveredLine: number | null = null;
  let pointerX: number | null = null;
  /** On a touch screen, the card opens once the line is tapped. */
  let tapped = false;

  function show(id: string) {
    scenario = scenarios.find((s) => s.id === id)!;
    for (const tab of stage.querySelectorAll<HTMLElement>('[role="tab"]')) {
      tab.setAttribute("aria-selected", String(tab.dataset.scenario === id));
    }
    for (const tries of stage.querySelectorAll<HTMLElement>("[data-tries]")) {
      tries.hidden = tries.dataset.tries !== id;
    }
    for (const panel of stage.querySelectorAll<HTMLElement>("[data-code]")) {
      panel.hidden = panel.dataset.code !== id;
    }
    const panel = stage.querySelector<HTMLElement>(`[data-code="${id}"]`)!;
    tree = specTree(scenario.spec, JSON.parse(panel.dataset.ranges!) as Ranges);
    code = new Code(panel);
    prompt.line = scenario.line;
    update();
  }

  // Each change reads the line again. A read that a newer one overtakes is dropped.
  let run = 0;
  let queue = Promise.resolve();
  function update() {
    queue = queue.then(read, read);
  }
  async function read() {
    const mine = ++run;
    const next = await analyse(scenario.spec, prompt.line, (name) => copy.notFound.replace("{name}", name));
    if (mine !== run) {
      return;
    }
    analysis = next;
    prompt.render(analysis.tokens);
    hovered = pointerX === null ? -1 : prompt.tokenAt(pointerX, analysis.tokens);
    printed.innerHTML = terminal(analysis.printed).value;
    const { title, body } = inspector(actionInput(analysis), analysis.problems, analysis.tokens, copy);
    outTitle.textContent = title;
    out.innerHTML = body.value;
    highlight();
    await openMenu();
  }

  function caretToken() {
    if (!prompt.focused) {
      return -1;
    }
    const caret = prompt.caret;
    return analysis.tokens.findIndex((t) => t.start <= caret && caret <= t.end);
  }

  /** Lights up the words and lines that go together, and opens the card for the word in focus. */
  function highlight() {
    const tokens = new Set<number>();
    const lines = new Set<number>();
    const addLines = (range: [number, number] | undefined) => {
      for (let l = range?.[0] ?? 1; range && l <= range[1]; l++) {
        lines.add(l);
      }
    };
    let focus = -1;
    if (hoveredLine !== null) {
      const node = tree.at(hoveredLine);
      if (node) {
        analysis.tokens.forEach((t, i) => t.pieces.includes(node.piece) && tokens.add(i));
        if (tokens.size) {
          addLines(node.lines);
        }
      }
    } else {
      const i = hovered >= 0 ? hovered : caretToken();
      if (i >= 0) {
        tokens.add(i);
        focus = coarse.matches && !tapped && hovered < 0 ? -1 : i;
        for (const piece of analysis.tokens[i].pieces) {
          addLines(tree.node(piece)?.lines);
        }
      }
    }
    prompt.activate(tokens);
    code.activate(lines);
    const body = focus >= 0 && !menu ? card(analysis.tokens[focus], tree, `${scenario.id}.ts`, copy) : null;
    prompt.showCard(focus, body);
  }

  /** Opens the menu for the word at the caret, once something's typed of it, or always when `force`d. */
  async function openMenu(force = false) {
    closeMenu();
    if (!prompt.focused || (!force && wordAt(prompt.line, prompt.caret).word.text === "")) {
      return;
    }
    const mine = run;
    const next = await suggest(scenario.spec, prompt.line, prompt.caret);
    if (mine !== run || !prompt.focused || next.items.length === 0) {
      return;
    }
    menu = next;
    prompt.showMenu(menu);
    highlight();
  }

  function closeMenu() {
    menu = null;
    prompt.showMenu(null);
  }

  function acceptSelected() {
    const done = accept(prompt.line, prompt.caret, menu!);
    prompt.line = done.line;
    prompt.caret = done.caret;
    closeMenu();
    update();
  }

  const input = prompt.input;
  input.addEventListener("input", () => {
    tapped = false;
    update();
  });
  input.addEventListener("click", () => {
    tapped = true;
    highlight();
    void openMenu();
  });
  input.addEventListener("focus", highlight);
  input.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      highlight();
      void openMenu();
    }
  });
  input.addEventListener("blur", () =>
    setTimeout(() => {
      if (!prompt.focused) {
        closeMenu();
        highlight();
      }
    }, 100),
  );
  input.addEventListener("keydown", (event) => {
    if (menu) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        menu = move(menu, event.key === "ArrowDown" ? 1 : -1);
        prompt.select(menu.selected);
      } else if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        acceptSelected();
      } else if (event.key === "Escape") {
        closeMenu();
        highlight();
      }
    } else if (event.key === "Tab" || (event.key === " " && event.ctrlKey)) {
      event.preventDefault();
      void openMenu(true);
    }
  });
  input.addEventListener("mousemove", (event) => {
    pointerX = event.clientX;
    const i = prompt.tokenAt(pointerX, analysis.tokens);
    if (i !== hovered) {
      hovered = i;
      highlight();
    }
  });
  input.addEventListener("mouseleave", () => {
    pointerX = null;
    hovered = -1;
    highlight();
  });

  const codeStack = stage.querySelector<HTMLElement>(".code-stack")!;
  codeStack.addEventListener("mouseover", (event) => {
    const line = code.lineAt(event.target);
    if (line !== hoveredLine) {
      hoveredLine = line;
      highlight();
    }
  });
  codeStack.addEventListener("mouseleave", () => {
    hoveredLine = null;
    highlight();
  });
  stage.querySelector(".prompt")!.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-try]");
    if (button) {
      prompt.line = button.dataset.try!;
      update();
    }
  });
  stage.querySelector(".tabs")!.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"]');
    if (tab) {
      show(tab.dataset.scenario!);
    }
  });
  stage.querySelector("[data-cmd]")!.addEventListener("mousedown", (event) => {
    const i = prompt.itemAt(event.target);
    if (i >= 0 && menu) {
      event.preventDefault();
      menu = { ...menu, selected: i };
      acceptSelected();
    }
  });

  hintScroll(stage.querySelector(".tabs")!);
  hintScrollAll("[data-tries], .code pre, [data-terminal], [data-out]", stage);
  void document.fonts.ready.then(() => {
    prompt.measure();
    show(stage.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!.dataset.scenario!);
  });
}
