/**
 * The schemas this library provides for an argument's `parse`, and what help
 * and completion read from any schema that describes itself as JSON Schema.
 *
 * @module
 */

import type { Arg, NonEmptyArray, StandardSchemaV1 } from "./types.js";

/** Digits, with a minus sign in front for a negative number. */
const integer = /^-?\d+$/;

/** Digits with a decimal point anywhere among them, like `12`, `1.5`, `.5` and `-3.`. */
const decimal = /^-?(?:\d+\.?\d*|\.\d+)$/;

/**
 * A number's type and range in words, like `integer from 1 to 65535`. Help
 * shows it, and {@link number} says it in its message.
 */
function describeRange(type: string, min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) {
    return `${type} from ${min} to ${max}`;
  }
  if (min !== undefined) {
    return `${type}, at least ${min}`;
  }
  return max === undefined ? type : `${type}, at most ${max}`;
}

/**
 * The values an argument can be, separated by ` | `. A value can have any
 * characters in it, so one that's empty or has a space, a quote, a comma, a
 * bracket or a `|` is in quotes, and the list can only be read one way.
 */
function describeChoices(values: readonly unknown[]): string {
  const shown: string[] = [];
  for (const value of values) {
    const text = String(value);
    shown.push(text === "" || /[\s|,()"']/.test(text) ? JSON.stringify(text) : text);
  }
  return shown.join(" | ");
}

/**
 * A schema for an argument's `parse` that turns the value into a number.
 *
 * The value is written in decimal digits, with an optional minus sign and
 * decimal point. It isn't read the way `Number` reads it, so an empty
 * string, `0x1F`, `1e3` and a value with a space in it are rejected.
 *
 * Help shows the type and range after the argument's description, like
 * `(integer from 1 to 65535)`.
 *
 * @param options - `min` and `max` are the least and greatest numbers
 * accepted, each included. `int` accepts whole numbers only.
 * @returns A Standard Schema that gives a number.
 */
export function number(
  options: { min?: number; max?: number; int?: boolean } = {},
): StandardSchemaV1<string, number> {
  const { min, max, int } = options;
  const type = int ? "integer" : "number";
  const pattern = int ? integer : decimal;
  return {
    "~standard": {
      version: 1,
      vendor: "@clo4/cli",
      validate(value) {
        const parsed = typeof value === "string" && pattern.test(value) ? Number(value) : NaN;
        if (
          Number.isNaN(parsed) ||
          (int && !Number.isSafeInteger(parsed)) ||
          (min !== undefined && parsed < min) ||
          (max !== undefined && parsed > max)
        ) {
          return { issues: [{ message: `expected ${int ? "an" : "a"} ${describeRange(type, min, max)}` }] };
        }
        return { value: parsed };
      },
      jsonSchema: {
        input() {
          const schema: Record<string, unknown> = { type };
          if (min !== undefined) {
            schema.minimum = min;
          }
          if (max !== undefined) {
            schema.maximum = max;
          }
          return schema;
        },
      },
    },
  };
}

/**
 * A schema for an argument's `parse` that accepts one of `values` and
 * rejects anything else. The action receives the value as one of them, so
 * `choice(["debug", "release"])` gives `"debug" | "release"`.
 *
 * Help shows the values after the argument's description, and completion
 * offers them unless the argument has suggestions of its own.
 *
 * @typeParam T - Inferred from the values. Do not supply it explicitly.
 * @param values - The values accepted, as the user types them.
 * @returns A Standard Schema that gives one of the values.
 */
export function choice<const T extends NonEmptyArray<string>>(
  values: T,
): StandardSchemaV1<string, T[number]> {
  return {
    "~standard": {
      version: 1,
      vendor: "@clo4/cli",
      validate(value) {
        return values.includes(value as string)
          ? { value: value as T[number] }
          : { issues: [{ message: `expected ${describeChoices(values)}` }] };
      },
      jsonSchema: {
        input: () => ({ type: "string", enum: [...values] }),
      },
    },
  };
}

/**
 * What the `parse` of `arg` says it takes, as JSON Schema. Undefined if the
 * argument has no `parse`, or its schema can't describe itself.
 */
function describedBy(arg: Arg): Record<string, unknown> | undefined {
  try {
    return arg.parse?.["~standard"].jsonSchema?.input({ target: "draft-2020-12" });
  } catch {
    // A schema with a part that JSON Schema has no words for.
    return undefined;
  }
}

/** The values the `parse` of `arg` accepts, if its schema lists them. Completion offers these. */
export function choicesOf(arg: Arg): string[] | undefined {
  const values = describedBy(arg)?.enum;
  return Array.isArray(values) ? values.map(String) : undefined;
}

/**
 * What the `parse` of `arg` accepts, in words for help: its values if the
 * schema lists them, or else its type and range if it's a number. Undefined
 * if the schema says neither.
 */
export function constraintOf(arg: Arg): string | undefined {
  const schema = describedBy(arg);
  if (!schema) {
    return undefined;
  }
  if (Array.isArray(schema.enum)) {
    return describeChoices(schema.enum);
  }
  const { type, minimum, maximum } = schema;
  if (type !== "integer" && type !== "number") {
    return undefined;
  }
  return describeRange(
    type,
    typeof minimum === "number" ? minimum : undefined,
    typeof maximum === "number" ? maximum : undefined,
  );
}
