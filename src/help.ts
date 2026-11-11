import type { Arg, Option, NonEmptyArray, Subcommand } from "./types.js";
import { closestChoice } from "./suggest.js";
import { CommandScope } from "./scope.js";
import type { OptionForm, VisibleOption } from "./scope.js";
import type { DidYouMean } from "./errors.js";
import { readHelpNames } from "./parse.js";
import { addDefaults, asArray, print, printError } from "./util.js";

// Help uses plain loops instead of array callbacks. V8 compiles each function
// the first time it's called, and a CLI prints help at most once a run, so
// each callback would be compiled for one use.

/** Remove the leading newline and the first line's indent from every line. */
function dedent(str: string) {
  const lines = str.split("\n").slice(1, -1);
  const margin = lines[0].length - lines[0].trimStart().length;
  return lines.map((line) => line.slice(margin)).join("\n");
}

export interface HelpConfig {
  /** Include the command description? Default: true. */
  description?: boolean;

  /** Include the usage summary? Default: true. */
  usage?: boolean;

  /** Ask if the user intended the input to be one of these choices. */
  didYouMean?: DidYouMean;
}

/** Get the help message used by the built-in help option and command. */
export function getHelp(path: NonEmptyArray<Subcommand>, config: HelpConfig = {}): string {
  const { description = true, usage = true, didYouMean } = config;
  return helpText(path, description, usage, didYouMean);
}

/**
 * Print `message` as an error, then the usage and flags of the last command on
 * `path`, suggesting the closest of `didYouMean.choices` if one is close.
 */
export function printUsageError(
  path: NonEmptyArray<Subcommand>,
  message: string,
  didYouMean?: DidYouMean,
): void {
  printError(`${message}\n\n${helpText(path, false, true, didYouMean)}`);
}

/**
 * A subcommand that prints help for its parent, or for the command the names
 * after it lead to from there, so `cli help a b` prints the help of `cli a b`.
 * It reads the names the way the parser reads them in place of `help`. The
 * first name that isn't a subcommand ends the names, so `cli help completion
 * zsh` prints the help of `completion`. Help reports that name as an unknown
 * command where the parser would. Add `{ ...helpCommand, isPersistent: true }`
 * instead to make `cli a b help` work too.
 */
export const helpCommand: Subcommand = {
  name: "help",
  description: "Print a help message",
  args: {
    name: "command",
    isOptional: true,
    isVariadic: true,
  },
  action({ path, args, help }) {
    const target = readHelpNames(path, args);
    if (target.error) {
      printUsageError(target.path, target.error.message, target.error.didYouMean);
      return 1;
    }
    print(help({ path: target.path }));
    return 0;
  },
};

/** A persistent help option that prints help for the selected command. */
export const help: Option = {
  name: ["-h", "--help"],
  description: "Print a help message",
  isPersistent: true,
  action({ path }) {
    print(helpText(path, true, true, undefined));
    return 0;
  },
};

const indent = "  ";
const minSpacingBetweenNameAndDesc = 2;
const defaultDesc = "No description";

/**
 * The help for the last command on `commands`. The description and usage line
 * are left out when `showDescription` or `showUsage` is false. A "did you
 * mean" line comes first if one of `didYouMean.choices` is close.
 */
function helpText(
  commands: NonEmptyArray<Subcommand>,
  showDescription: boolean,
  showUsage: boolean,
  didYouMean: DidYouMean | undefined,
): string {
  const command = commands[commands.length - 1];

  const commandsSection = command.subcommands ? subcommandRows(command.subcommands) : "";

  let flagsSection = "";
  let globalFlagsSection = "";
  let required = "";
  const scope = CommandScope.at(commands);
  let { local, persistent } = scope.visible();
  if (local.length > 0 || persistent.length > 0) {
    // A command without parents or subcommands has no global flags to set
    // apart, so all its flags are listed in the order it defines them. Without
    // persistent flags, the local ones are in that order already.
    if (commands.length === 1 && commandsSection === "" && persistent.length > 0) {
      local = inDefinitionOrder(command.options ?? [], local, persistent);
      persistent = [];
    }
    const localNames = optionNames(scope, local);
    const persistentNames = optionNames(scope, persistent);
    let width = 0;
    for (let i = 0; i < localNames.length; i++) {
      width = Math.max(width, localNames[i].length);
    }
    for (let i = 0; i < persistentNames.length; i++) {
      width = Math.max(width, persistentNames[i].length);
    }
    if (local.length > 0) {
      flagsSection = rows("Flags:", localNames, optionDescriptions(local), false, width);
    }
    if (persistent.length > 0) {
      globalFlagsSection = rows(
        "Global flags:",
        persistentNames,
        optionDescriptions(persistent),
        false,
        width,
      );
    }
    if (showUsage) {
      required = requiredOptions(local, localNames) + requiredOptions(persistent, persistentNames);
    }
  }

  let usage = "";
  if (showUsage) {
    for (let i = 0; i < commands.length; i++) {
      const name = commands[i].name;
      usage += (i === 0 ? "" : " ") + (typeof name === "string" ? name : longest(name));
    }
    usage += required;
    if (flagsSection !== "" || globalFlagsSection !== "") {
      usage += " [flags]";
    }
    if (command.requiresSubcommand) {
      usage += " <command>";
    } else if (command.args !== undefined) {
      const args = asArray(command.args);
      if (args.length > 0) {
        usage += ` ${summarizeArguments(args)}`;
      }
    }
  }

  const argumentsSection =
    command.requiresSubcommand || command.args === undefined || !hasArgumentDetails(command.args)
      ? ""
      : argumentRows(asArray(command.args));

  const parts: string[] = [];
  if (didYouMean) {
    const suggestion = closestChoice(didYouMean.input, didYouMean.choices);
    if (suggestion) {
      parts.push(`    Did you mean '${suggestion}'?`);
    }
  }
  const description = command.description;
  if (showDescription && description) {
    // Checked here so that help for a description without a leading newline
    // doesn't compile `dedent`.
    parts.push(description[0] === "\n" ? dedent(description) : description);
  }
  if (usage) {
    parts.push(`Usage:\n${indent}${usage}`);
  }
  if (argumentsSection !== "") {
    parts.push(argumentsSection);
  }
  if (commandsSection !== "") {
    parts.push(commandsSection);
  }
  if (flagsSection !== "") {
    parts.push(flagsSection);
  }
  if (globalFlagsSection !== "") {
    parts.push(globalFlagsSection);
  }
  return `${parts.join("\n\n")}\n`;
}

/**
 * The Commands section, or "" if every subcommand is hidden. Only the
 * command's own subcommands are listed, not inherited ones. It's a function of
 * its own so that help for a command without subcommands doesn't compile it.
 */
function subcommandRows(subcommands: readonly Subcommand[]): string {
  const names: string[] = [];
  const descriptions: string[] = [];
  for (let i = 0; i < subcommands.length; i++) {
    const subcommand = subcommands[i];
    if (!subcommand.hidden) {
      const name = subcommand.name;
      names.push(typeof name === "string" ? name : byLength(name).join(", "));
      descriptions.push(subcommand.description ?? defaultDesc);
    }
  }
  return names.length > 0 ? rows("Commands:", names, descriptions, true) : "";
}

/**
 * The visible options in the order `options` defines them. An option defined
 * twice is listed twice.
 */
function inDefinitionOrder(
  options: readonly Option[],
  local: readonly VisibleOption[],
  persistent: readonly VisibleOption[],
): VisibleOption[] {
  const byOption = new Map<Option, VisibleOption>();
  for (let i = 0; i < local.length; i++) {
    byOption.set(local[i].option, local[i]);
  }
  for (let i = 0; i < persistent.length; i++) {
    byOption.set(persistent[i].option, persistent[i]);
  }
  const ordered: VisibleOption[] = [];
  for (let i = 0; i < options.length; i++) {
    const visible = byOption.get(options[i]);
    if (visible) {
      ordered.push(visible);
    }
  }
  return ordered;
}

/** How help writes each option: its live names, each with its arguments. */
function optionNames(scope: CommandScope, options: readonly VisibleOption[]): string[] {
  const names: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const { option, names: live } = options[i];
    names.push(optionToString(option, scope.forms(option, live)));
  }
  return names;
}

/** Each option's description, ending with the defaults the parser uses. */
function optionDescriptions(options: readonly VisibleOption[]): string[] {
  const descriptions: string[] = [];
  for (let i = 0; i < options.length; i++) {
    const option = options[i].option;
    const defaults: string[] = [];
    if (option.args !== undefined) {
      addDefaults(defaults, option.args);
    }
    descriptions.push(
      defaults.length === 0
        ? (option.description ?? defaultDesc)
        : withDefaults(option.description, defaults, defaultDesc),
    );
  }
  return descriptions;
}

/** The required options for the usage line, each after a space. */
function requiredOptions(options: readonly VisibleOption[], names: readonly string[]): string {
  let text = "";
  for (let i = 0; i < options.length; i++) {
    if (options[i].option.isRequired) {
      text += ` ${names[i]}`;
    }
  }
  return text;
}

/**
 * Whether help lists the arguments in a section of their own. An argument's
 * name is often description enough, so they're only listed when one of them
 * has a description or a default. Otherwise the section would only repeat the
 * usage line. It's checked before {@link argumentRows} is called, so that help
 * for a command without one doesn't compile that.
 */
function hasArgumentDetails(args: Arg | readonly Arg[]): boolean {
  if (!Array.isArray(args)) {
    const arg = args as Arg;
    return arg.description !== undefined || arg.default !== undefined;
  }
  for (let i = 0; i < args.length; i++) {
    if (args[i].description !== undefined || args[i].default !== undefined) {
      return true;
    }
  }
  return false;
}

/**
 * The Arguments section. An argument without a description is listed by name
 * alone.
 */
function argumentRows(args: readonly Arg[]): string {
  const names: string[] = [];
  const descriptions: string[] = [];
  let width = 0;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const name = (arg.name || "argument") + (arg.isVariadic ? "..." : "");
    names.push(name);
    width = Math.max(width, name.length);
    descriptions.push(
      arg.default === undefined ? (arg.description ?? "") : withDefaults(arg.description, [arg.default], ""),
    );
  }
  return rows("Arguments:", names, descriptions, false, width);
}

/**
 * A section of help: its title, then each name with its description in a
 * column `width` wide names leave, or as wide as the widest command name. Each
 * line after a description's first starts at that column. A command shows the
 * first paragraph of its description. An argument or option with an empty
 * description shows its name alone.
 */
function rows(
  title: string,
  names: readonly string[],
  descriptions: readonly string[],
  commands: boolean,
  width = 0,
): string {
  if (commands) {
    for (let i = 0; i < names.length; i++) {
      width = Math.max(width, names[i].length);
    }
  }
  const newline = `\n${indent}${" ".repeat(width + minSpacingBetweenNameAndDesc)}`;
  let text = title;
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let description = descriptions[i];
    if (commands) {
      description = description.split("\n\n")[0];
    } else if (description === "") {
      text += `\n${indent}${name}`;
      continue;
    }
    const spaces = " ".repeat(width - name.length + minSpacingBetweenNameAndDesc);
    text += `\n${indent}${name}${spaces}${description.split("\n").join(newline)}`;
  }
  return text;
}

/**
 * A description ending with the defaults the parser uses. They go on a line of
 * their own when the last line would be too long for the 68 characters the
 * spec checks allow.
 */
function withDefaults(
  description: string | undefined,
  defaults: readonly string[],
  defaultDesc: string,
): string {
  if (defaults.length === 0) {
    return description ?? defaultDesc;
  }
  const shown = `(default: ${defaults.join(" ")})`;
  if (description === undefined) {
    return shown;
  }
  const lastLine = description.slice(description.lastIndexOf("\n") + 1);
  return `${description}${lastLine.length + 1 + shown.length <= 68 ? " " : "\n"}${shown}`;
}

/** The first of the longest strings. */
function longest(strings: readonly string[]): string {
  let result = strings[0];
  for (let i = 1; i < strings.length; i++) {
    if (strings[i].length > result.length) {
      result = strings[i];
    }
  }
  return result;
}

/** A copy of `items`, shortest first by each string or form name, keeping ties in order. */
function byLength<T extends string | OptionForm>(items: readonly T[]): T[] {
  const sorted: T[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const length = typeof item === "string" ? item.length : (item as OptionForm).name.length;
    let at = sorted.length;
    while (at > 0 && lengths[at - 1] > length) {
      at--;
    }
    sorted.splice(at, 0, item);
    lengths.splice(at, 0, length);
  }
  return sorted;
}

/**
 * Show an option's names, each written with its arguments the way `forms`
 * says. Names written the same way share one copy of the arguments.
 */
export function optionToString(option: Option, forms: readonly OptionForm[]): string {
  const args = option.args === undefined ? [] : asArray(option.args);
  if (forms.length === 1) {
    return forms[0].name + argumentsAfterName(args, forms[0].join);
  }
  const sorted = byLength(forms);
  const joins: (string | null)[] = [];
  let text = "";
  for (let i = 0; i < sorted.length; i++) {
    const join = sorted[i].join;
    if (joins.includes(join)) {
      continue;
    }
    let names = sorted[i].name;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].join === join) {
        names += `, ${sorted[j].name}`;
      }
    }
    text += (joins.length === 0 ? "" : ", ") + names + argumentsAfterName(args, join);
    joins.push(join);
  }
  return text;
}

/** The text after an option's name that shows its arguments, joined to the name by `join`. */
function argumentsAfterName(args: readonly Arg[], join: string | null): string {
  if (args.length === 0) {
    return "";
  }
  if (join === null) {
    return ` ${summarizeArguments(args)}`;
  }
  const first = args[0];
  const name = first.name || "argument";
  const joined =
    (first.isOptional ? `[${join}${name}]` : `${join}<${name}>`) + (first.isVariadic ? "..." : "");
  return args.length > 1 ? `${joined} ${summarizeArguments(args.slice(1))}` : joined;
}

export function summarizeArguments(args: readonly Arg[]): string {
  let text = "";
  for (let i = 0; i < args.length; i++) {
    text += (i === 0 ? "" : " ") + argToString(args[i]);
  }
  return text;
}

export function argToString(arg: Arg): string {
  const name = arg.name || "argument";
  return (arg.isOptional ? `[${name}]` : `<${name}>`) + (arg.isVariadic ? "..." : "");
}
