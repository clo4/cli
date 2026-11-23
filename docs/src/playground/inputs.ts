import * as CLI from "@clo4/cli";
import type { Analysis } from "./analyse";
import { asArray, keyOf, names } from "./util";

/** How an action reads an option. */
export type Read = "get" | "has" | "count";

export interface ArgInput {
  name: string;
  value: unknown;
}

export interface OptionInput {
  name: string;
  read: Read;
  value: unknown;
  /** The option wasn't on the line, so the value is its default. */
  isDefault: boolean;
}

/** What the action gets from a line, or the option whose action runs in its place. */
export type ActionInput =
  | {
      kind: "input";
      /** The names of the commands from the program to the one whose action runs. */
      path: string[];
      args: ArgInput[];
      options: OptionInput[];
    }
  | { kind: "replaced"; option: string };

export function actionInput({ result, tokens }: Analysis): ActionInput | null {
  if (!result) {
    return null;
  }
  const replacing = tokens
    .flatMap((token) => token.pieces)
    .findLast((piece) => "action" in piece && piece.action === result.action);
  if (replacing && replacing !== result.path.at(-1)) {
    return { kind: "replaced", option: keyOf(replacing as CLI.Option) };
  }

  const command = result.path.at(-1)!;
  const declared = asArray(command.args);
  const args = result.args.map((value, i) => ({
    name: declared[Math.min(i, declared.length - 1)]?.name ?? `args[${i}]`,
    value,
  }));

  const inScope = new Set([
    ...result.path.slice(0, -1).flatMap((parent) => asArray(parent.options).filter((o) => o.isPersistent)),
    ...asArray(command.options),
  ]);
  const options: OptionInput[] = [];
  for (const option of inScope) {
    if (option === CLI.help) {
      continue;
    }
    const name = keyOf(option);
    const isDefault = !result.options.has(name);
    if (!option.args && option.isRepeatable) {
      options.push({ name, read: "count", value: result.options.count(name), isDefault });
    } else if (!option.args) {
      options.push({ name, read: "has", value: !isDefault, isDefault });
    } else {
      options.push({ name, read: "get", value: result.options.get(name), isDefault });
    }
  }
  return { kind: "input", path: result.path.map((command) => names(command)[0]), args, options };
}
