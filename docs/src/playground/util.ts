import type { Option } from "@clo4/cli";

export function asArray<T>(x: T | readonly T[] | undefined): readonly T[] {
  if (x === undefined) {
    return [];
  }
  return Array.isArray(x) ? (x as readonly T[]) : [x as T];
}

/** The names of a command or option. */
export const names = (piece: { name?: string | readonly string[] }): readonly string[] => asArray(piece.name);

/** The name an action reads an option by: its last, which is its long name by convention. */
export const keyOf = (option: Option): string => names(option).at(-1)!;
