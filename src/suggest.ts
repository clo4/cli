/**
 * "Did you mean" suggestions for unknown commands and options.
 *
 * This only runs after a mistake, but it's loaded on every run, so it's kept
 * small and does nothing until it's called.
 *
 * @module
 */

/** How many `-` or `+` characters `name` starts with. */
function dashCount(name: string): number {
  let i = 0;
  while (i < name.length && (name[i] === "-" || name[i] === "+")) i++;
  return i;
}

/** Whether every character of `short` appears in `long`, in order. */
function isAbbreviation(short: string, long: string): boolean {
  let i = 0;
  for (let j = 0; j < long.length && i < short.length; j++) {
    if (long[j] === short[i]) i++;
  }
  return i === short.length;
}

/**
 * Levenshtein distance where swapping two adjacent characters also counts as
 * one edit (optimal string alignment). Returns `limit + 1` as soon as the
 * distance must be larger than `limit`.
 */
function editDistance(a: string, b: string, limit: number): number {
  // Three rows of the usual table: two rows back, the previous row and this one.
  let before = new Uint32Array(b.length + 1);
  let previous = new Uint32Array(b.length + 1);
  let current = new Uint32Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) previous[j] = j;

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      let d = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, before[j - 2] + 1);
      }
      current[j] = d;
      if (d < rowMin) rowMin = d;
    }
    // Every later row is at least this row's minimum.
    if (rowMin > limit) return limit + 1;
    const recycled = before;
    before = previous;
    previous = current;
    current = recycled;
  }
  return previous[b.length];
}

/**
 * The choice the user most likely meant by `input`, or `undefined` if none is
 * close enough to be worth suggesting. In order:
 *
 * 1. The only choice that starts with the input (`--verb` for `--verbose`).
 * 2. The only choice that contains every character of the input in order, for
 *    inputs of 3 or more characters (`bld` for `build`).
 * 3. The choice with the fewest edits, allowing one edit per three characters
 *    of the input. Leading dashes don't count toward the length or the edits.
 */
export function closestChoice(input: string, choices: readonly string[]): string | undefined {
  const inputDashes = dashCount(input);
  const bare = input.slice(inputDashes);

  if (bare.length >= 2) {
    let match: string | undefined;
    let count = 0;
    for (const choice of choices) {
      if (choice.startsWith(input)) {
        match = choice;
        count++;
      }
    }
    if (count === 1) return match;
  }

  if (bare.length >= 3) {
    let match: string | undefined;
    let count = 0;
    for (const choice of choices) {
      if (isAbbreviation(bare, choice.slice(dashCount(choice)))) {
        match = choice;
        count++;
      }
    }
    if (count === 1) return match;
  }

  let best: string | undefined;
  let limit = Math.floor(bare.length / 3);
  for (const choice of choices) {
    const other = choice.slice(dashCount(choice));
    // The length difference is a lower bound on the number of edits.
    if (Math.abs(other.length - bare.length) > limit) continue;
    const distance = editDistance(bare, other, limit);
    if (distance <= limit && (best === undefined || distance < limit)) {
      best = choice;
      // Later choices have to be strictly closer to replace this one.
      limit = distance;
      if (distance === 0) break;
    }
  }
  return best;
}
