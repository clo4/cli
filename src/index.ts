export type {
  Action,
  ActionInit,
  Arg,
  CommandBody,
  CommandPath,
  Generator,
  NonEmptyArray,
  Option,
  OptionArgs,
  SingleOrArray,
  SingleOrArrayOrEmpty,
  Spec,
  Subcommand,
  Suggestion,
  Template,
} from "./types.js";

export { completion } from "./completion.js";
export type { Shell } from "./completion.js";
export { help, helpCommand } from "./help.js";
export { printError, run } from "./run.js";
export { command, spec } from "./spec.js";

import { completion } from "./completion.js";
import { help, helpCommand } from "./help.js";
import { printError, run } from "./run.js";
import { command, spec } from "./spec.js";

export default {
  command,
  completion,
  help,
  helpCommand,
  printError,
  run,
  spec,
};
