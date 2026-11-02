import { closest } from "fastest-levenshtein";

import type { Action, Arg, Option, NonEmptyArray, SingleOrArray, Subcommand } from "./types.js";
import { makeArray, makeArray1, print, printActionError } from "./util.js";

function getNamed<T extends { name: SingleOrArray<string> }>(
  named: readonly T[],
  name: string,
): T | null {
  return named.find((obj) => makeArray(obj.name).includes(name)) ?? null;
}

function getParserDirective<Key extends keyof NonNullable<Subcommand["parserDirectives"]>>(
  path: readonly Subcommand[],
  key: Key,
): NonNullable<Subcommand["parserDirectives"]>[Key] | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const command = path[index];
    if (command?.parserDirectives && key in command.parserDirectives) {
      return command.parserDirectives[key];
    }
  }
  return undefined;
}

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
  didYouMean?: {
    input: string;
    choices: readonly string[];
  };
}

/** Get the help message used by the built-in help option and command. */
export function getHelp(path: NonEmptyArray<Subcommand>, config: HelpConfig = {}): string {
  const { description = true, usage = true, didYouMean } = config;
  const sections = getSections(path);
  if (didYouMean) {
    sections.didYouMean = closest(didYouMean.input, didYouMean.choices as string[]);
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
 * Action that prints usage for commands where a subcommand must be provided.
 */
export const usage: Action = ({ path, args: [command], help }) => {
  if (command === undefined) {
    print(help());
    return 0;
  }

  if (command === "") {
    printActionError(
      `Expected a command, but the value was empty\n\n${help({ description: false })}`,
    );
    return 1;
  }

  const subcommands = path
    .at(-1)
    ?.subcommands?.filter((cmd) => !cmd.hidden)
    .flatMap((cmd) => cmd.name);

  if (subcommands && subcommands.length > 0) {
    const matchPrefix = getParserDirective(path, "subcommandsMatchUniquePrefix");
    if (matchPrefix) {
      const possible = subcommands.filter((name) => name.startsWith(command));
      if (possible.length > 0) {
        printActionError(
          `Ambiguous command '${command}', could be: ${possible.join(", ")}\n\n${help({
            description: false,
          })}`,
        );
        return 1;
      }
    }

    printActionError(
      `Unknown command '${command}'\n\n${help({
        description: false,
        didYouMean: {
          input: command,
          choices: subcommands,
        },
      })}`,
    );
    return 1;
  }

  printActionError(`Unknown command '${command}'\n\n${help({ description: false })}`);

  return 1;
};

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
      printActionError(
        `No subcommands, try using 'help' with nothing after it\n\n${help({
          description: false,
          path: helpRoot,
        })}`,
      );
      return 1;
    }

    const command = getNamed(parent.subcommands, commandName);
    if (!command) {
      const subcommands = parent.subcommands
        .filter((cmd) => !cmd.hidden)
        .flatMap((cmd) => cmd.name);

      if (subcommands.length > 0) {
        printActionError(
          `There is no subcommand named '${commandName}'\n\n${help({
            path: helpRoot,
            didYouMean: {
              input: commandName,
              choices: subcommands,
            },
          })}`,
        );
        return 1;
      }

      printActionError(
        `There is no subcommand named '${commandName}'\n\n${help({
          description: false,
          path: helpRoot,
        })}`,
      );
      return 1;
    }

    print(help({ path: [...helpRoot, command] }));
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

function nonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined;
}

function getSections(commands: NonEmptyArray<Subcommand>): HelpSections {
  const command = commands[commands.length - 1];

  const description = command.description;
  const defaultDesc = "No description";

  const subcommands: HelpSections["subcommands"] = command.subcommands
    ? command.subcommands
        .filter((subcommand) => !subcommand.hidden)
        .map((subcommand) => [
          makeArray1(subcommand.name)
            .sort((a, b) => a.length - b.length)
            .join(", "),
          subcommand.description ?? defaultDesc,
        ])
    : [];

  let persistentOptionObjects: Option[] = [];
  let optionObjects: Option[] = [];

  let persistentOptions: HelpSections["persistentOptions"] = [];
  let options: HelpSections["options"] = [];

  if (commands.length === 1 && subcommands.length === 0) {
    optionObjects = command.options ? command.options.filter((option) => !option.hidden) : [];
    options = optionObjects.map((option) => [
      optionToString(option),
      option.description ?? defaultDesc,
    ]);
  } else {
    persistentOptionObjects = commands
      .map((command) => command.options)
      .filter(nonNullable)
      .flat()
      .filter((option) => option.isPersistent && !option.hidden);

    persistentOptions = persistentOptionObjects.map((option) => [
      optionToString(option),
      option.description ?? defaultDesc,
    ]);

    optionObjects = (command.options ?? []).filter(
      (option) => !option.hidden && !option.isPersistent,
    );

    options = optionObjects.map((option) => [
      optionToString(option),
      option.description ?? defaultDesc,
    ]);
  }

  const usage = (() => {
    const parts = [getSubcommandPathString(commands)];
    const required = [
      ...optionObjects.filter((option) => option.isRequired),
      ...persistentOptionObjects.filter((option) => option.isRequired),
    ];
    for (const option of required) {
      parts.push(optionToString(option));
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

export function optionToString(option: Option): string {
  const name = makeArray1(option.name)
    .sort((a, b) => a.length - b.length)
    .join(", ");

  const optionArgs = makeArray(option.args);

  if (optionArgs.length === 0) {
    return name;
  }

  if (option.requiresSeparator) {
    const separator = option.requiresSeparator === true ? "=" : option.requiresSeparator;
    if (optionArgs[0].isOptional) {
      return `${name}[${separator}${optionArgs[0].name || "argument"}]`;
    }
    return `${name}${separator}<${optionArgs[0].name || "argument"}>`;
  }
  return `${name} ${summarizeArguments(optionArgs)}`;
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
