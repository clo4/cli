import * as CLI from "@clo4/cli";
import type { Arg, Option, Spec, Subcommand } from "@clo4/cli";
import { ParseError, parse, tokenReader } from "@clo4/cli/unstable";
import type { Ranges } from "./ranges";
import { hintScroll, hintScrollAll } from "@/lib/scroll-hint";
import { spec as greet } from "./scenarios/greet";
import { spec as wait } from "./scenarios/wait";
import { spec as build } from "./scenarios/build";
import { spec as resize } from "./scenarios/resize";
import { spec as serve } from "./scenarios/serve";

const specs: Record<string, Spec> = { greet, wait, build, resize, serve };

type Kind = "program" | "subcommand" | "option" | "value" | "argument" | "separator" | "unknown" | "unread";
type Piece = Spec | Subcommand | Option | Arg;

interface Problem {
  message: string;
  token?: Token;
  start?: number;
}

interface Token {
  text: string;
  start: number;
  end: number;
  kind: Kind;
  objects: Piece[];
  problems: Problem[];
}

interface Copy {
  result: string;
  problems: string;
  output: string;
  notFound: string;
  program: string;
  subcommand: string;
  option: string;
  value: string;
  argument: string;
  separator: string;
  optionAction: string;
}

const asArray = <T>(x: T | readonly T[] | undefined): readonly T[] =>
  x === undefined ? [] : Array.isArray(x) ? (x as readonly T[]) : [x as T];
const names = (o: { name?: string | readonly string[] }) => asArray(o.name);
const primary = (o: Option) => names(o).at(-1)!;
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fill = (text: string, vars: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

function tokenize(raw: string): Pick<Token, "text" | "start" | "end">[] {
  const out: Pick<Token, "text" | "start" | "end">[] = [];
  let i = 0;
  while (i < raw.length) {
    while (raw[i] === " ") {
      i++;
    }
    if (i >= raw.length) {
      break;
    }
    const start = i;
    let text = "";
    let quote: string | null = null;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (quote) {
        if (c === quote) {
          quote = null;
        } else if (c === "\\" && quote === '"' && i + 1 < raw.length) {
          text += raw[++i];
        } else {
          text += c;
        }
      } else if (c === " ") {
        break;
      } else if (c === "'" || c === '"') {
        quote = c;
      } else if (c === "\\" && i + 1 < raw.length) {
        text += raw[++i];
      } else {
        text += c;
      }
    }
    out.push({ text, start, end: i });
  }
  return out;
}

function piecesOf(spec: Spec): Map<Piece, string> {
  const paths = new Map<Piece, string>();
  function walk(command: Spec | Subcommand, path: string) {
    paths.set(command, path);
    asArray(command.args).forEach((arg, i) => paths.set(arg, `${path}.args.${i}`));
    asArray(command.options).forEach((option, i) => {
      paths.set(option, `${path}.options.${i}`);
      asArray(option.args).forEach((arg, j) => paths.set(arg, `${path}.options.${i}.args.${j}`));
    });
    asArray(command.subcommands).forEach((sub, i) => walk(sub, `${path}.subcommands.${i}`));
  }
  walk(spec, "spec");
  return paths;
}

function show(value: unknown) {
  if (typeof value === "number") {
    return `${value} <span class="ty">number</span>`;
  }
  if (typeof value === "string") {
    return `${escape(JSON.stringify(value))} <span class="ty">string</span>`;
  }
  if (value === undefined) {
    return `<span class="ty">undefined</span>`;
  }
  return `${escape(JSON.stringify(value))} <span class="ty">${Array.isArray(value) ? "array" : typeof value}</span>`;
}

export function start(stage: HTMLElement) {
  const copy: Copy = JSON.parse(stage.dataset.copy!);
  const input = stage.querySelector<HTMLInputElement>("[data-input]")!;
  const mirror = stage.querySelector<HTMLElement>("[data-mirror]")!;
  const cmd = stage.querySelector<HTMLElement>("[data-cmd]")!;
  const out = stage.querySelector<HTMLElement>("[data-out]")!;
  const outTitle = stage.querySelector<HTMLElement>("[data-out-title]")!;
  const terminal = stage.querySelector<HTMLElement>("[data-terminal]")!;

  let id = stage.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!.dataset.scenario!;
  let spec = specs[id];
  let pieces = piecesOf(spec);
  let panel = stage.querySelector<HTMLElement>(`[data-code="${id}"]`)!;
  let ranges: Ranges = JSON.parse(panel.dataset.ranges!);
  let lines = [...panel.querySelectorAll<HTMLElement>(".line")];
  let tokens: Token[] = [];
  let hovered = -1;
  let hoveredLine: number | null = null;
  let pointerX: number | null = null;
  let completions: { value: string; description?: string; open?: boolean }[] = [];
  let selected = 0;
  let word = { text: "", start: 0 };
  let run = 0;
  let charWidth = 0;

  const rangeOf = (piece: Piece) => {
    const path = pieces.get(piece);
    return path ? ranges[path] : undefined;
  };

  function select(next: string) {
    id = next;
    spec = specs[id];
    pieces = piecesOf(spec);
    for (const tab of stage.querySelectorAll<HTMLElement>('[role="tab"]')) {
      tab.setAttribute("aria-selected", String(tab.dataset.scenario === id));
      if (tab.dataset.scenario === id) {
        input.value = tab.dataset.line!;
      }
    }
    for (const tries of stage.querySelectorAll<HTMLElement>("[data-tries]")) {
      tries.hidden = tries.dataset.tries !== id;
    }
    for (const code of stage.querySelectorAll<HTMLElement>("[data-code]")) {
      code.hidden = code.dataset.code !== id;
    }
    panel = stage.querySelector<HTMLElement>(`[data-code="${id}"]`)!;
    ranges = JSON.parse(panel.dataset.ranges!);
    lines = [...panel.querySelectorAll<HTMLElement>(".line")];
    update();
  }

  let queue = Promise.resolve();
  function update() {
    queue = queue.then(read, read);
  }

  async function execute(argv: string[]) {
    const lines: { fd: 1 | 2; text: string }[] = [];
    const { log, error } = console;
    console.log = (...values: unknown[]) => lines.push({ fd: 1, text: `${values.map(String).join(" ")}\n` });
    console.error = (...values: unknown[]) =>
      lines.push({ fd: 2, text: `${values.map(String).join(" ")}\n` });
    try {
      await CLI.run(spec, { argv, setExitCode: false });
    } finally {
      console.log = log;
      console.error = error;
    }
    return lines;
  }

  async function read() {
    const mine = ++run;
    const toks: Token[] = tokenize(input.value).map((t) => ({
      ...t,
      kind: "unread",
      objects: [],
      problems: [],
    }));
    let printed: { fd: 1 | 2; text: string }[] = [];
    let result: Awaited<ReturnType<typeof parse>> | null = null;
    const problems: Problem[] = [];

    if (toks.length && toks[0].text !== spec.name) {
      toks[0].kind = "program";
      problems.push({ message: fill(copy.notFound, { name: toks[0].text }), token: toks[0] });
      toks[0].problems.push(problems[0]);
      printed = [{ fd: 2, text: `${problems[0].message}\n` }];
    } else if (toks.length) {
      Object.assign(toks[0], { kind: "program", objects: [spec] });
      const argv = toks.slice(1);
      const reader = tokenReader(spec);
      let command: Spec | Subcommand = spec;
      let positional = 0;
      for (const t of argv) {
        const reading = await reader.read(t.text);
        t.kind = reading.kind === "options" ? "option" : reading.kind;
        if (reading.kind === "subcommand") {
          command = reading.command;
          positional = 0;
          t.objects = [reading.command];
        } else if (reading.kind === "options") {
          t.objects = [...reading.options];
        } else if (reading.kind === "value") {
          t.objects = [reading.option, ...asArray(reading.option.args)];
        } else if (reading.kind === "argument") {
          const args = asArray(command.args);
          const arg = args[Math.min(positional++, args.length - 1)];
          if (arg) {
            t.objects = [arg];
          }
        }
      }
      try {
        result = await parse(
          argv.map((t) => t.text),
          spec,
        );
      } catch (error) {
        if (!(error instanceof ParseError)) {
          throw error;
        }
        for (const p of error.problems ?? [error]) {
          const token = p.context.token === undefined ? undefined : toks[p.context.token + 1];
          const problem = { message: p.message, token, start: p.context.start };
          problems.push(problem);
          token?.problems.push(problem);
        }
      }
      printed = await execute(argv.map((t) => t.text));
    }
    if (mine !== run) {
      return;
    }

    tokens = toks;
    renderMirror();
    hovered = hoverAt();
    renderOutput(result, problems);
    terminal.innerHTML = printed
      .flatMap(({ fd, text }) =>
        text
          .split(/(?<=\n)/)
          .map((line) =>
            fd === 2 && line.startsWith("Error: ")
              ? `<span class="stderr">${escape(line)}</span>`
              : escape(line),
          ),
      )
      .join("");
    refreshActive();
    refreshCompletions();
  }

  function renderMirror() {
    const raw = input.value;
    let html = "";
    let last = 0;
    tokens.forEach((t, i) => {
      html += escape(raw.slice(last, t.start));
      const text = raw.slice(t.start, t.end);
      const start = t.problems.find((p) => p.start !== undefined)?.start;
      const body =
        start === undefined
          ? escape(text)
          : `${escape(text.slice(0, text.length - (t.text.length - start)))}<span data-problem>${escape(text.slice(text.length - (t.text.length - start)))}</span>`;
      const flag = t.problems.length && start === undefined ? " data-problem" : "";
      html += `<span class="tk" data-i="${i}"${flag}>${body}</span>`;
      last = t.end;
    });
    mirror.innerHTML = `${html}${escape(raw.slice(last))} `;
    requestAnimationFrame(markOverflow);
    mirror.scrollLeft = input.scrollLeft;
  }

  function renderOutput(result: Awaited<ReturnType<typeof parse>> | null, problems: Problem[]) {
    if (problems.length) {
      outTitle.textContent = copy.problems;
      out.innerHTML = problems
        .map((p) => {
          const where = p.token ? (p.start === undefined ? p.token.text : p.token.text.slice(p.start)) : "";
          return `<div class="problem"><b>${escape(where)}</b><span>${escape(p.message)}</span></div>`;
        })
        .join("");
      return;
    }
    outTitle.textContent = copy.result;
    if (!result) {
      out.innerHTML = "";
      return;
    }
    const replacing = tokens
      .flatMap((t) => t.objects)
      .findLast((piece) => "action" in piece && piece.action === result.action);
    if (replacing && replacing !== result.path.at(-1)) {
      const name = primary(replacing as Option);
      out.innerHTML = `<p class="note">${fill(escape(copy.optionAction), { option: `<code>${escape(name)}</code>` })}</p>`;
      return;
    }
    const last = result.path.at(-1)!;
    const argList = asArray(last.args);
    let rows = "";
    result.args.forEach((value, i) => {
      rows += `<dt>${escape(argList[Math.min(i, argList.length - 1)]?.name ?? `args[${i}]`)}</dt><dd>${show(value)}</dd>`;
    });
    const inScope = [
      ...result.path.slice(0, -1).flatMap((c) => asArray(c.options).filter((o) => o.isPersistent)),
      ...asArray(last.options),
    ];
    for (const option of new Set(inScope)) {
      if (option === CLI.help) {
        continue;
      }
      const key = primary(option);
      if (!option.args && option.isRepeatable) {
        rows += `<dt>${escape(key)}</dt><dd>${result.options.count(key)} <span class="ty">count()</span></dd>`;
      } else if (!option.args) {
        rows += `<dt>${escape(key)}</dt><dd>${result.options.has(key)} <span class="ty">has()</span></dd>`;
      } else if (result.options.has(key)) {
        rows += `<dt>${escape(key)}</dt><dd>${show(result.options.get(key))}</dd>`;
      } else {
        rows += `<dt class="default">${escape(key)}</dt><dd class="default">${show(result.options.get(key))}</dd>`;
      }
    }
    out.innerHTML = `<dl class="kv">${rows}</dl>`;
  }

  function caretToken() {
    if (document.activeElement !== input) {
      return -1;
    }
    const c = input.selectionStart ?? 0;
    return tokens.findIndex((t) => t.start <= c && c <= t.end);
  }

  function refreshActive() {
    const activeTokens = new Set<number>();
    const activeLines = new Set<number>();
    const addLines = (range: [number, number] | undefined) => {
      for (let l = range?.[0] ?? 1; range && l <= range[1]; l++) {
        activeLines.add(l);
      }
    };
    let card = -1;
    const quiet = coarse.matches && !tapped && hovered < 0;
    if (hoveredLine !== null) {
      let best: Piece | null = null;
      let bestSize = Infinity;
      for (const [piece] of pieces) {
        const r = rangeOf(piece);
        if (r && r[0] <= hoveredLine && hoveredLine <= r[1] && r[1] - r[0] < bestSize) {
          best = piece;
          bestSize = r[1] - r[0];
        }
      }
      if (best) {
        tokens.forEach((t, i) => t.objects.includes(best!) && activeTokens.add(i));
      }
      const r = best && activeTokens.size ? rangeOf(best) : undefined;
      addLines(r);
    } else {
      const i = hovered >= 0 ? hovered : caretToken();
      if (i >= 0 && i < tokens.length) {
        activeTokens.add(i);
        card = quiet ? -1 : i;
        for (const piece of tokens[i].objects) {
          addLines(rangeOf(piece));
        }
      }
    }
    for (const el of mirror.querySelectorAll<HTMLElement>(".tk")) {
      el.toggleAttribute("data-active", activeTokens.has(Number(el.dataset.i)));
    }
    lines.forEach((line, i) => line.toggleAttribute("data-active", activeLines.has(i + 1)));
    showCard(card);
  }

  function describe(t: Token): string | null {
    if (t.problems.length) {
      return t.problems.map((p) => `<div class="problem-text">${escape(p.message)}</div>`).join("");
    }
    const where = (piece: Piece) => {
      const r = rangeOf(piece);
      return r ? ` · ${id}.ts:${r[0]}` : "";
    };
    const description = (piece: Piece) =>
      "description" in piece && piece.description ? `<div>${escape(piece.description)}</div>` : "";
    const o = t.objects[0];
    switch (t.kind) {
      case "program":
        return o
          ? `<div class="kind">${copy.program}${where(o)}</div><code>${escape(spec.name)}</code>${description(o)}`
          : null;
      case "subcommand":
        return `<div class="kind">${copy.subcommand}${where(o)}</div><code>${escape(names(o as Subcommand)[0])}</code>${description(o)}`;
      case "option":
        return [...new Set(t.objects)]
          .map((x) => {
            const times = t.objects.filter((y) => y === x).length;
            return `<div class="kind">${copy.option}${where(x)}${times > 1 ? ` · ×${times}` : ""}</div>${names(
              x as Option,
            )
              .map((n) => `<code>${escape(n)}</code>`)
              .join("")}${description(x)}`;
          })
          .join("");
      case "value": {
        const option = o as Option;
        return `<div class="kind">${fill(escape(copy.value), { name: `<code>${escape(primary(option))}</code>` })}${where(option)}</div><code>&lt;${escape(asArray(option.args)[0]?.name ?? "value")}&gt;</code>`;
      }
      case "argument":
        return o
          ? `<div class="kind">${copy.argument}${where(o)}</div><code>&lt;${escape((o as Arg).name ?? "")}&gt;</code>${description(o)}`
          : null;
      case "separator":
        return `<div class="kind">${copy.separator}</div><code>--</code>`;
      default:
        return null;
    }
  }

  function keepInside(pop: HTMLElement) {
    const room = cmd.clientWidth - pop.offsetWidth;
    if (pop.offsetLeft > room) {
      pop.style.left = `${Math.max(0, room)}px`;
    }
  }

  function tokenLeft(i: number) {
    const span = mirror.querySelector<HTMLElement>(`[data-i="${i}"]`);
    return span ? span.offsetLeft - mirror.scrollLeft : 0;
  }

  function showCard(i: number) {
    const existing = cmd.querySelector<HTMLElement>(".card");
    const html = i >= 0 && !completions.length ? describe(tokens[i]) : null;
    if (!html) {
      existing?.remove();
      return;
    }
    if (existing?.dataset.i === String(i) && existing.innerHTML === html) {
      return;
    }
    existing?.remove();
    const card = document.createElement("div");
    card.className = "pop card";
    card.dataset.i = String(i);
    card.innerHTML = html;
    card.style.left = `${tokenLeft(i)}px`;
    cmd.append(card);
    keepInside(card);
  }

  async function refreshCompletions(force = false) {
    cmd.querySelector(".completions")?.remove();
    completions = [];
    if (document.activeElement !== input) {
      return;
    }
    const caret = input.selectionStart ?? 0;
    const before = tokenize(input.value.slice(0, caret));
    const endsInWord = before.length > 0 && before.at(-1)!.end === caret;
    const typed = endsInWord ? before.pop()! : { text: "", start: caret };
    if (!force && typed.text === "") {
      return;
    }
    const mine = run;
    let list: CLI.Suggestion[];
    if (before.length === 0) {
      list = [{ name: spec.name }];
    } else if (before[0].text !== spec.name) {
      list = [];
    } else {
      list = await CLI.complete(
        spec,
        before.slice(1).map((t) => t.text),
        typed.text,
      );
    }
    if (mine !== run || document.activeElement !== input) {
      return;
    }
    completions = list
      .flatMap(({ name, description, incomplete }) =>
        asArray(name).map((value) => ({ value, description, open: incomplete })),
      )
      .filter((c) => c.value.startsWith(typed.text) && c.value !== typed.text);
    word = typed;
    selected = 0;
    if (!completions.length) {
      return;
    }
    cmd.querySelector(".card")?.remove();
    const box = document.createElement("div");
    box.className = "pop completions";
    box.setAttribute("role", "listbox");
    box.innerHTML = completions
      .map(
        (c, i) =>
          `<div role="option" aria-selected="${i === selected}"><code>${escape(c.value)}</code>${c.description ? `<span>${escape(c.description)}</span>` : ""}</div>`,
      )
      .join("");
    const at = tokens.findIndex((t) => t.start === word.start);
    box.style.left = `${at >= 0 ? tokenLeft(at) : charX(word.start)}px`;
    cmd.append(box);
    keepInside(box);
  }

  function moveSelection(by: number) {
    selected = (selected + by + completions.length) % completions.length;
    cmd
      .querySelectorAll(".completions [role=option]")
      .forEach((el, i) => el.setAttribute("aria-selected", String(i === selected)));
  }

  function accept() {
    const c = completions[selected];
    const insert = c.value + (c.open ? "" : " ");
    input.value = input.value.slice(0, word.start) + insert + input.value.slice(input.selectionStart ?? 0);
    const at = word.start + insert.length;
    input.setSelectionRange(at, at);
    completions = [];
    update();
  }

  const padLeft = () => parseFloat(getComputedStyle(input).paddingLeft);
  const charX = (i: number) => padLeft() + i * charWidth - input.scrollLeft;
  function measure() {
    const probe = document.createElement("span");
    probe.textContent = "0".repeat(50);
    mirror.append(probe);
    charWidth = probe.getBoundingClientRect().width / 50;
    probe.remove();
  }
  function hoverAt() {
    if (pointerX === null || !charWidth) {
      return -1;
    }
    const c = Math.floor(
      (pointerX - input.getBoundingClientRect().left - padLeft() + input.scrollLeft) / charWidth,
    );
    return tokens.findIndex((t) => t.start <= c && c < t.end);
  }

  const coarse = matchMedia("(pointer: coarse)");
  let tapped = false;
  const markOverflow = () =>
    cmd.toggleAttribute("data-more-text", input.scrollLeft + input.clientWidth < input.scrollWidth - 1);
  input.addEventListener("input", () => {
    tapped = false;
    update();
  });
  input.addEventListener("scroll", () => {
    mirror.scrollLeft = input.scrollLeft;
    markOverflow();
  });
  input.addEventListener("click", () => {
    tapped = true;
    refreshActive();
    refreshCompletions();
  });
  input.addEventListener("focus", refreshActive);
  input.addEventListener("keyup", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      refreshActive();
      refreshCompletions();
    }
  });
  input.addEventListener("blur", () =>
    setTimeout(() => {
      if (document.activeElement !== input) {
        cmd.querySelector(".completions")?.remove();
        completions = [];
        refreshActive();
      }
    }, 100),
  );
  input.addEventListener("keydown", (event) => {
    if (completions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveSelection(1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        moveSelection(-1);
      } else if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        accept();
      } else if (event.key === "Escape") {
        cmd.querySelector(".completions")?.remove();
        completions = [];
        refreshActive();
      }
    } else if (event.key === "Tab" || (event.key === " " && event.ctrlKey)) {
      event.preventDefault();
      refreshCompletions(true);
    }
  });
  input.addEventListener("mousemove", (event) => {
    pointerX = event.clientX;
    const i = hoverAt();
    if (i !== hovered) {
      hovered = i;
      refreshActive();
    }
  });
  input.addEventListener("mouseleave", () => {
    pointerX = null;
    hovered = -1;
    refreshActive();
  });
  stage.querySelector(".code-stack")!.addEventListener("mouseover", (event) => {
    const line = (event.target as Element).closest<HTMLElement>(".line");
    const n = line ? lines.indexOf(line) + 1 || null : null;
    if (n !== hoveredLine) {
      hoveredLine = n;
      refreshActive();
    }
  });
  stage.querySelector(".code-stack")!.addEventListener("mouseleave", () => {
    hoveredLine = null;
    refreshActive();
  });
  stage.querySelector(".prompt")!.addEventListener("click", (event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-try]");
    if (!button) {
      return;
    }
    input.value = button.dataset.try!;
    update();
  });
  stage.querySelector(".tabs")!.addEventListener("click", (event) => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"]');
    if (tab) {
      select(tab.dataset.scenario!);
    }
  });
  cmd.addEventListener("mousedown", (event) => {
    const option = (event.target as Element).closest(".completions [role=option]");
    if (option) {
      event.preventDefault();
      selected = [...option.parentElement!.children].indexOf(option);
      accept();
    }
  });

  hintScroll(stage.querySelector(".tabs")!);
  hintScrollAll("[data-tries], .code pre, [data-terminal], [data-out]", stage);
  new ResizeObserver(markOverflow).observe(input);
  queue.then(markOverflow);

  document.fonts.ready.then(() => {
    measure();
    update();
  });
}
