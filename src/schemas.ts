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

/** The least and greatest numbers a schema accepts, and whether each is itself left out. */
export interface Bounds {
  min?: number | undefined;
  max?: number | undefined;
  minExclusive?: boolean;
  maxExclusive?: boolean;
}

/**
 * A number's type and range in words, like `integer from 1 to 65535`. Help
 * shows it, and {@link number} says it in its message. A range with a bound
 * that's left out names each bound, like `number, more than 0 and less than 1`.
 */
export function describeRange(type: string, { min, max, minExclusive, maxExclusive }: Bounds): string {
  if (min !== undefined && max !== undefined && !minExclusive && !maxExclusive) {
    return `${type} from ${min} to ${max}`;
  }
  const least = min === undefined ? "" : `${minExclusive ? "more than" : "at least"} ${min}`;
  const greatest = max === undefined ? "" : `${maxExclusive ? "less than" : "at most"} ${max}`;
  if (least === "" && greatest === "") {
    return type;
  }
  return `${type}, ${least}${least !== "" && greatest !== "" ? " and " : ""}${greatest}`;
}

/**
 * A value an argument can be, as help and messages show it. A value can have
 * any characters in it, so one that's empty or has a space, a quote, a
 * comma, a bracket or a `|` is in quotes, and a list of them separated by
 * ` | ` can only be read one way.
 */
function describeChoice(value: unknown): string {
  const text = String(value);
  return text === "" || /[\s|,()"']/.test(text) ? JSON.stringify(text) : text;
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
          return {
            issues: [{ message: `expected ${int ? "an" : "a"} ${describeRange(type, { min, max })}` }],
          };
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
          : { issues: [{ message: `expected ${values.map(describeChoice).join(" | ")}` }] };
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
export function describedBy(arg: Arg): Record<string, unknown> | undefined {
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

/** The range a JSON Schema for a number gives. */
export function boundsOf(schema: Record<string, unknown>): Bounds {
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema;
  const min = typeof exclusiveMinimum === "number" ? exclusiveMinimum : minimum;
  const max = typeof exclusiveMaximum === "number" ? exclusiveMaximum : maximum;
  return {
    min: typeof min === "number" ? min : undefined,
    max: typeof max === "number" ? max : undefined,
    minExclusive: typeof exclusiveMinimum === "number",
    maxExclusive: typeof exclusiveMaximum === "number",
  };
}

/**
 * What the `parse` of `arg` accepts, in words for help: each of its values
 * if the schema lists them, or else its type and range if it's a number, as
 * the one element. Undefined if the schema says neither. Help joins the
 * elements with ` | `, and starts a new line between two when it has to.
 */
export function constraintOf(arg: Arg): string[] | undefined {
  const schema = describedBy(arg);
  if (!schema) {
    return undefined;
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(describeChoice);
  }
  const { type } = schema;
  return type === "integer" || type === "number" ? [describeRange(type, boundsOf(schema))] : undefined;
}
