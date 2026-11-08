import type { Arg, Option, NonEmptyArray, Subcommand } from "./types.js";
import { closestChoice } from "./suggest.js";
import { visibleSubcommands } from "./subcommands.js";
import { CommandScope } from "./scope.js";
import type { OptionForm, VisibleOption } from "./scope.js";
import type { DidYouMean } from "./errors.js";
import { addDefaults, asArray, getMaxArgs, makeArray, makeArray1, print, printError } from "./util.js";

function dedent(str: string) {
  if (str[0] !== "\n") {
    return str;
  }
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
  const sections = getSections(path);
  if (didYouMean) {
    sections.didYouMean = closestChoice(didYouMean.input, didYouMean.choices);
  }
  if (!description) {
    sections.description = undefined;
  }
  if (!usage) {
    sections.usage = undefined;
  }
  return formatHelpSections(sections);
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
  printError(`${message}\n\n${getHelp(path, { description: false, didYouMean })}`);
}

/**
 * A subcommand that prints help for its parent, or for the command the names
 * after it lead to from there, so `cli help a b` prints the help of `cli a b`.
 * It reads names until one isn't a subcommand. A token where the command takes
 * arguments, or where it has no subcommands, ends the names, so
 * `cli help completion zsh` prints the help of `completion`. Any other token
 * is an unknown command. Add `{ ...helpCommand, isPersistent: true }` instead
 * to make `cli a b help` work too.
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
    const self = path[path.length - 1];
    const helpPath = path.slice(0, -1) as unknown as [Subcommand, ...Subcommand[]];
    // Match each name the way the parser would have matched it in place of `help`.
    const scope = CommandScope.at(helpPath);

    for (const name of args) {
      const command = helpPath[helpPath.length - 1];
      if (!command.subcommands) {
        break;
      }
      const match = scope.matchSubcommand(name);
      // With a persistent help command, `cli help a help` is `cli a help`.
      if (match.command === self && !command.subcommands.includes(self)) {
        break;
      }
      if (match.command) {
        helpPath.push(match.command);
        scope.enter(match.command);
        continue;
      }
      if (!command.requiresSubcommand && getMaxArgs(command.args) > 0) {
        break;
      }
      const { message, didYouMean } = match.reason();
      printUsageError(helpPath, message, didYouMean);
      return 1;
    }

    print(help({ path: helpPath }));
    return 0;
  },
};

/** A persistent help option that prints help for the selected command. */
export const help: Option = {
  name: ["-h", "--help"],
  description: "Print a help message",
  isPersistent: true,
  action({ path }) {
    print(formatHelpSections(getSections(path)));
    return 0;
  },
};

type HelpSections = {
  description?: string;
  usage?: string;
  didYouMean?: string;
  args: [name: string, description: string][];
  options: [formattedName: string, description: string][];
  persistentOptions: [formattedName: string, description: string][];
  subcommands: [formattedName: string, description: string][];
};

function getSubcommandPathString(commands: NonEmptyArray<Subcommand>): string {
  return commands.map((command) => getLongestString(makeArray1(command.name))).join(" ");
}

function getSections(commands: NonEmptyArray<Subcommand>): HelpSections {
  const command = commands[commands.length - 1];
  const scope = CommandScope.at(commands);
  const show = ({ option, names }: VisibleOption) => optionToString(option, scope.forms(option, names));

  const description = command.description;
  const defaultDesc = "No description";

  const subcommands: HelpSections["subcommands"] = visibleSubcommands(command.subcommands).map(
    (subcommand) => [
      makeArray1(subcommand.name)
        .sort((a, b) => a.length - b.length)
        .join(", "),
      subcommand.description ?? defaultDesc,
    ],
  );

  const visible = scope.visible();
  let optionObjects = visible.local;
  let persistentOptionObjects = visible.persistent;
  // A command without parents or subcommands has no global flags to set apart.
  if (commands.length === 1 && subcommands.length === 0) {
    const byOption = new Map([...optionObjects, ...persistentOptionObjects].map((v) => [v.option, v]));
    optionObjects = (command.options ?? []).flatMap((option) => byOption.get(option) ?? []);
    persistentOptionObjects = [];
  }
  const row = (visible: VisibleOption): [string, string] => {
    const defaults: string[] = [];
    addDefaults(defaults, asArray(visible.option.args));
    return [show(visible), withDefaults(visible.option.description, defaults, defaultDesc)];
  };
  const options = optionObjects.map(row);
  const persistentOptions = persistentOptionObjects.map(row);

  const usage = (() => {
    const parts = [getSubcommandPathString(commands)];
    for (const visible of [...optionObjects, ...persistentOptionObjects]) {
      if (visible.option.isRequired) {
        parts.push(show(visible));
      }
    }
    if (options.length || persistentOptions.length) {
      parts.push("[flags]");
    }
    if (command.requiresSubcommand) {
      parts.push("<command>");
    } else {
      const args = makeArray(command.args);
      if (args.length > 0) {
        parts.push(summarizeArguments(args));
      }
    }
    return parts.join(" ");
  })();

  // The positional arguments are only listed when there's more to say about
  // them than the usage line does. An argument's name is often description
  // enough, so one without a description is listed by name alone.
  const positionals = command.requiresSubcommand ? [] : asArray(command.args);
  const described = positionals.some((arg) => arg.description !== undefined || arg.default !== undefined);
  const args: HelpSections["args"] = described
    ? positionals.map((arg) => [
        (arg.name || "argument") + (arg.isVariadic ? "..." : ""),
        withDefaults(arg.description, arg.default === undefined ? [] : [arg.default], ""),
      ])
    : [];

  return {
    usage,
    description,
    args,
    persistentOptions,
    options,
    subcommands,
  };
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

export function formatHelpSections(sections: HelpSections): string {
  const parts = [];

  const indent = "  ";

  if (sections.didYouMean) {
    parts.push(`    Did you mean '${sections.didYouMean}'?`);
  }

  if (sections.description) {
    parts.push(dedent(sections.description));
  }

  if (sections.usage) {
    parts.push(`Usage:\n${indent}${sections.usage}`);
  }

  const longestOptionName = Math.max(
    0,
    ...sections.options.map(([name]) => name.length),
    ...sections.persistentOptions.map(([name]) => name.length),
  );
  const minSpacingBetweenNameAndDesc = 2;

  // Each name, then its description in a column `width` wide names leave.
  const formatRows = (rows: [string, string][], width: number) => {
    const lines = [];
    const newline = indent + " ".repeat(width + minSpacingBetweenNameAndDesc);
    for (const [name, desc] of rows) {
      if (desc === "") {
        lines.push(`${indent}${name}`);
        continue;
      }
      const spaces = " ".repeat(width - name.length + minSpacingBetweenNameAndDesc);
      const [head, ...tail] = desc.split("\n");
      const description = [head, ...tail.map((line) => newline + line)].join("\n");
      lines.push(`${indent}${name}${spaces}${description}`);
    }
    return lines;
  };
  const formatOptions = (options: [string, string][]) => formatRows(options, longestOptionName);

  if (sections.args.length > 0) {
    const longestArgName = Math.max(...sections.args.map(([name]) => name.length));
    parts.push(["Arguments:", ...formatRows(sections.args, longestArgName)].join("\n"));
  }

  if (sections.subcommands.length > 0) {
    const lines = ["Commands:"];
    const longestName = Math.max(...sections.subcommands.map(([name]) => name.length));
    const newline = indent + " ".repeat(longestName + minSpacingBetweenNameAndDesc);
    for (const [name, desc] of sections.subcommands) {
      const spaces = " ".repeat(longestName - name.length + minSpacingBetweenNameAndDesc);
      const [head, ...tail] = desc.split("\n\n")[0].split("\n");
      const description = [head, ...tail.map((line) => newline + line)].join("\n");
      lines.push(`${indent}${name}${spaces}${description}`);
    }
    parts.push(lines.join("\n"));
  }

  if (sections.options.length > 0) {
    const lines = ["Flags:", ...formatOptions(sections.options)];
    parts.push(lines.join("\n"));
  }

  if (sections.persistentOptions.length > 0) {
    const lines = ["Global flags:", ...formatOptions(sections.persistentOptions)];
    parts.push(lines.join("\n"));
  }
  return parts.join("\n\n") + "\n";
}

export function getLongestString(strings: NonEmptyArray<string>): string {
  let longest = strings[0];
  for (let i = 1; i < strings.length; i++) {
    const string = strings[i];
    if (string.length > longest.length) {
      longest = string;
    }
  }
  return longest;
}

/**
 * Show an option's names, each written with its arguments the way `forms`
 * says. Names written the same way share one copy of the arguments.
 */
export function optionToString(option: Option, forms: readonly OptionForm[]): string {
  const optionArgs = makeArray(option.args);
  const sorted = [...forms].sort((a, b) => a.name.length - b.name.length);
  const joins = [...new Set(sorted.map((form) => form.join))];
  return joins
    .map((join) => {
      const names = sorted.filter((form) => form.join === join).map((form) => form.name);
      return names.join(", ") + argumentsAfterName(optionArgs, join);
    })
    .join(", ");
}

/** The text after an option's name that shows its arguments, joined to the name by `join`. */
function argumentsAfterName(args: Arg[], join: string | null): string {
  if (args.length === 0) {
    return "";
  }
  if (join === null) {
    return ` ${summarizeArguments(args)}`;
  }
  const [first, ...rest] = args;
  const name = first.name || "argument";
  const joined =
    (first.isOptional ? `[${join}${name}]` : `${join}<${name}>`) + (first.isVariadic ? "..." : "");
  return rest.length > 0 ? `${joined} ${summarizeArguments(rest)}` : joined;
}

export function summarizeArguments(args: Arg[]) {
  return args.map((arg) => argToString(arg)).join(" ");
}

export function argToString(arg: Arg): string {
  const name = arg.name || "argument";
  let lhs = "<";
  let rhs = ">";
  let suffix = "";
  if (arg.isOptional) {
    lhs = "[";
    rhs = "]";
  }
  if (arg.isVariadic) {
    suffix = "...";
  }
  return `${lhs}${name}${rhs}${suffix}`;
}
