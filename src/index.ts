/**
 * The default export contains the same runtime values as the named exports.
 *
 * @module cli
 */

export type {
  Action,
  ActionInit,
  Arg,
  CommandPath,
  NonEmptyArray,
  Option,
  OptionArgs,
  SingleOrArray,
  SingleOrArrayOrEmpty,
  Spec,
  StandardResult,
  StandardSchemaV1,
  Subcommand,
  Suggester,
  Suggestion,
  SuggestInit,
  Template,
} from "./types.js";

export { complete } from "./complete.js";
export type { CompleteOptions, Completion } from "./complete.js";
export { completion } from "./completion.js";
export type { Shell } from "./completion.js";
export { help, helpCommand } from "./help.js";
export { print, printError, run } from "./run.js";
export { int, many, optional, sepBy, seq, text, uint } from "./combinators.js";
export type { Seq } from "./combinators.js";
export { choice, number } from "./schemas.js";
export type { Parser, Part } from "./schemas.js";
export type { RunOptions } from "./run.js";
export { command, spec } from "./spec.js";

import { int, many, optional, sepBy, seq, text, uint } from "./combinators.js";
import { complete } from "./complete.js";
import { completion } from "./completion.js";
import { help, helpCommand } from "./help.js";
import { print, printError, run } from "./run.js";
import { choice, number } from "./schemas.js";
import { command, spec } from "./spec.js";

export default {
  choice,
  command,
  complete,
  completion,
  help,
  helpCommand,
  int,
  many,
  number,
  optional,
  print,
  printError,
  run,
  sepBy,
  seq,
  spec,
  text,
  uint,
};
