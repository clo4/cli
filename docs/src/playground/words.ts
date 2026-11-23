/** A word of a command line, where it is, and its text with the quotes and escapes read the way a shell reads them. */
export interface Word {
  text: string;
  start: number;
  end: number;
}

/** The words of `line`, split at spaces outside quotes. */
export function words(line: string): Word[] {
  const found: Word[] = [];
  let i = 0;
  while (i < line.length) {
    while (line[i] === " ") {
      i++;
    }
    if (i >= line.length) {
      break;
    }
    const start = i;
    let text = "";
    let quote: string | null = null;
    for (; i < line.length; i++) {
      const c = line[i];
      if (quote) {
        if (c === quote) {
          quote = null;
        } else if (c === "\\" && quote === '"' && i + 1 < line.length) {
          text += line[++i];
        } else {
          text += c;
        }
      } else if (c === " ") {
        break;
      } else if (c === "'" || c === '"') {
        quote = c;
      } else if (c === "\\" && i + 1 < line.length) {
        text += line[++i];
      } else {
        text += c;
      }
    }
    found.push({ text, start, end: i });
  }
  return found;
}

/**
 * The word the caret is in or at the end of, and the words before it. With
 * the caret after a space, the word is empty.
 */
export function wordAt(line: string, caret: number): { before: Word[]; word: Word } {
  const before = words(line.slice(0, caret));
  const last = before.at(-1);
  if (last && last.end === caret) {
    before.pop();
    return { before, word: last };
  }
  return { before, word: { text: "", start: caret, end: caret } };
}
