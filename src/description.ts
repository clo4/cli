/**
 * What an argument's parser says about the values it takes. Help, completion,
 * the "did you mean" line of a rejected value and the spec checks all read it
 * from {@link describeParser}, so they describe a parser the same way.
 *
 * A built-in parser describes itself from its atom. Any other Standard
 * Schema is described by the JSON Schema it gives, if it gives one.
 *
 * @module
 */

import type { Arg, StandardSchemaV1 } from "./types.js";
import {
  accepts,
  completionsOf,
  describeChoice,
  describeRange,
  isParser,
  listOf,
  patternOf,
} from "./schemas.js";
import type { Bounds, Parser } from "./schemas.js";

/** A number's type and range, as a parser takes it. */
export interface NumberRange {
  type: "integer" | "number";
  bounds: Bounds;
}

/** What an argument's parser says about the values it takes. See {@link describeParser}. */
export interface ParserDescription {
  /**
   * The strings it lists among its values, as the user types them. A
   * rejected value is compared with these.
   */
  readonly choices: readonly string[] | undefined;
  /** Its type and range, if it takes a number. */
  readonly range: NumberRange | undefined;
  /**
   * What help shows it accepts: each of its values if it lists them, or
   * else its type and range if it takes a number, or else a built-in
   * parser's pattern, as the one element. Help joins the elements with
   * ` | `, and starts a new line between two when it has to.
   */
  readonly constraint: readonly string[] | undefined;
  /**
   * What a partly typed value could become, for completion to offer. A
   * value that isn't whole yet, like `1920x`, is `open`.
   */
  complete(partial: string): { value: string; open?: true }[];
}

/** What the parser of `arg` says about the values it takes, or undefined if it has none. */
export function describeParser(arg: Arg): ParserDescription | undefined {
  const parse = arg.parse;
  if (parse === undefined) {
    return undefined;
  }
  return isParser(parse) ? builtIn(parse) : standard(jsonSchemaOf(parse));
}

/**
 * A built-in parser, which describes itself from its atom: as the JSON Schema
 * the atom gives, with what JSON Schema has no words for added.
 */
function builtIn(parser: Parser<unknown>): ParserDescription {
  const described = standard(parser.atom.schema?.(parser));
  return {
    choices: parser.atom.choices?.(parser),
    range: described.range,
    // A choice with a parser among its values lists each one, like `auto | <int>`.
    constraint: described.constraint ?? listOf(parser) ?? [patternOf(parser)],
    complete: (partial) =>
      completionsOf(parser, partial).map((value) =>
        accepts(parser, value) ? { value } : { value, open: true },
      ),
  };
}

/** A schema described by the JSON Schema it gives, if any. */
function standard(schema: Record<string, unknown> | undefined): ParserDescription {
  const values = schema?.enum;
  const choices = Array.isArray(values) ? values.map(String) : undefined;
  const range = rangeOf(schema);
  return {
    choices,
    range,
    constraint: Array.isArray(values)
      ? values.map(describeChoice)
      : // Help says `int`, the name the parser has in a spec.
        range && [describeRange(range.type === "integer" ? "int" : "number", range.bounds)],
    complete: () => (choices ?? []).map((value) => ({ value })),
  };
}

/**
 * What `schema` says it takes, as JSON Schema. Undefined if it can't
 * describe itself.
 */
function jsonSchemaOf(schema: StandardSchemaV1): Record<string, unknown> | undefined {
  try {
    return schema["~standard"].jsonSchema?.input({ target: "draft-2020-12" });
  } catch {
    // A schema with a part that JSON Schema has no words for.
    return undefined;
  }
}

/** The type and range of a JSON Schema for a number, or undefined if it isn't one. */
function rangeOf(schema: Record<string, unknown> | undefined): NumberRange | undefined {
  const type = schema?.type;
  if (type !== "integer" && type !== "number") {
    return undefined;
  }
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum } = schema!;
  const min = typeof exclusiveMinimum === "number" ? exclusiveMinimum : minimum;
  const max = typeof exclusiveMaximum === "number" ? exclusiveMaximum : maximum;
  return {
    type,
    bounds: {
      min: typeof min === "number" ? min : undefined,
      max: typeof max === "number" ? max : undefined,
      minExclusive: typeof exclusiveMinimum === "number",
      maxExclusive: typeof exclusiveMaximum === "number",
    },
  };
}
