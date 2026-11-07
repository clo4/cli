import type { Arg, Option, NonEmptyArray, Subcommand } from "./types.js";
import { closestChoice } from "./suggest.js";
import { matchSubcommand, visibleSubcommands } from "./subcommands.js";
import { OptionScope } from "./scope.js";
import type { OptionForm, VisibleOption } from "./scope.js";
import type { DidYouMean } from "./errors.js";
import { makeArray, makeArray1, print, printError } from "./util.js";

function dedent(str: string) {
  if (str[0] !== "\n") return str;
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

/** A subcommand that prints help for its parent or a sibling command. */
export const helpCommand: Subcommand = {
  name: "help",
  description: "Print a help message",
  args: {
    name: "command",
    isOptional: true,
  },
  action({ path, args: [commandName], help }) {
    const helpRoot = path.slice(0, -1) as unknown as NonEmptyArray<Subcommand>;

    if (!commandName) {
      print(help({ path: helpRoot }));
      return 0;
    }

    const parent = path[path.length - 2];

    if (!parent.subcommands) {
      printUsageError(helpRoot, "No subcommands, try using 'help' with nothing after it");
      return 1;
    }

    // Match the name the way the parser would have matched it in place of `help`.
    const { directives } = OptionScope.at(helpRoot);
    const match = matchSubcommand(parent.subcommands, commandName, directives);
    if (!match.command) {
      const { message, didYouMean } = match.reason();
      printUsageError(helpRoot, message, didYouMean);
      return 1;
    }

    print(help({ path: [...helpRoot, match.command] }));
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
  options: [formattedName: string, description: string][];
  persistentOptions: [formattedName: string, description: string][];
  subcommands: [formattedName: string, description: string][];
};

function getSubcommandPathString(commands: NonEmptyArray<Subcommand>): string {
  return commands.map((command) => getLongestString(makeArray1(command.name))).join(" ");
}

function getSections(commands: NonEmptyArray<Subcommand>): HelpSections {
  const command = commands[commands.length - 1];
  const scope = OptionScope.at(commands);
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
  const row = (visible: VisibleOption): [string, string] => [
    show(visible),
    visible.option.description ?? defaultDesc,
  ];
  const options = optionObjects.map(row);
  const persistentOptions = persistentOptionObjects.map(row);

  const usage = (() => {
    const parts = [getSubcommandPathString(commands)];
    for (const visible of [...optionObjects, ...persistentOptionObjects]) {
      if (visible.option.isRequired) parts.push(show(visible));
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

  return {
    usage,
    description,
    persistentOptions,
    options,
    subcommands,
  };
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

  const formatOptions = (options: [string, string][]) => {
    const lines = [];
    const newline = indent + " ".repeat(longestOptionName + minSpacingBetweenNameAndDesc);
    for (const [name, desc] of options) {
      const spaces = " ".repeat(longestOptionName - name.length + minSpacingBetweenNameAndDesc);
      const [head, ...tail] = desc.split("\n");
      const description = [head, ...tail.map((line) => newline + line)].join("\n");
      lines.push(`${indent}${name}${spaces}${description}`);
    }
    return lines;
  };

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
  if (args.length === 0) return "";
  if (join === null) return ` ${summarizeArguments(args)}`;
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
