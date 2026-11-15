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
  Generator,
  NonEmptyArray,
  Option,
  OptionArgs,
  SingleOrArray,
  SingleOrArrayOrEmpty,
  Spec,
  StandardResult,
  StandardSchemaV1,
  Subcommand,
  Suggestion,
  Template,
} from "./types.js";

export { completion } from "./completion.js";
export type { Shell } from "./completion.js";
export { help, helpCommand } from "./help.js";
export { printError, run } from "./run.js";
export { choice, number } from "./schemas.js";
export type { RunOptions } from "./run.js";
export { command, spec } from "./spec.js";

import { completion } from "./completion.js";
import { help, helpCommand } from "./help.js";
import { printError, run } from "./run.js";
import { choice, number } from "./schemas.js";
import { command, spec } from "./spec.js";

export default {
  choice,
  command,
  completion,
  help,
  helpCommand,
  number,
  printError,
  run,
  spec,
};
