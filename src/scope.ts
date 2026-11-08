import type { Option, Spec, Subcommand } from "./types.js";
import { applyDirectives, defaultDirectives } from "./directives.js";
import type { Directives } from "./directives.js";
import { NoSubcommand } from "./subcommands.js";
import { asArray, getMaxArgs, getMinArgs } from "./util.js";

/** The subcommand a token names, or why it names none. See {@link CommandScope.matchSubcommand}. */
export type SubcommandMatch = { command: Subcommand } | NoSubcommand;

/**
 * How the next token can match a subcommand: by any name the command's
 * directives allow, or only by an exact name.
 */
export interface SubcommandMatching {
  exactOnly: boolean;
}

/** An option that can be used here, and the names that still refer to it. */
export interface VisibleOption {
  option: Option;
  names: string[];
}

/** How one name of an option is written with its value, at one command. */
export interface OptionForm {
  name: string;
  /**
   * What joins the name to the option's first value in the same token, or null
   * if the value is the next token. It's the required separator for an option
   * that requires one, and "" for an option named "-" or "+", which reads its
   * value straight after the name, like `-5`. It's null for an option without
   * arguments.
   */
  join: string | null;
}

/**
 * What a name means at one command on a path: the options, subcommands,
 * directives and argument limits in effect there.
 *
 * Moving to a subcommand replaces the local options and adds its persistent
 * options to the inherited ones. A name refers to one option: a local option
 * wins over a persistent one, and a later option wins over an earlier one in
 * the same list. A subcommand wins over an option where the next token can
 * name a subcommand. The parser, help, completion and the spec checker all
 * ask this module what a name refers to, so they can't disagree.
 */
export class CommandScope {
  /** Non-persistent options of the current command, in definition order. */
  readonly local: Option[] = [];
  /** Persistent options from every command on the path, in definition order. */
  readonly persistent: Option[] = [];
  /**
   * Persistent subcommands of the commands above the current one, nearest
   * command first, so a nearer one wins a name.
   */
  readonly inheritedSubcommands: Subcommand[] = [];
  /** The directives in effect. A subcommand inherits each until it sets its own. */
  readonly directives: Directives = defaultDirectives();
  private current: Spec | Subcommand | null = null;
  /** The fewest positional arguments the current command takes. */
  argsMin = 0;
  /** The most positional arguments the current command takes. */
  argsMax = 0;

  /** The scope at the last command on `path`. */
  static at(path: readonly (Spec | Subcommand)[]): CommandScope {
    const scope = new CommandScope();
    for (const command of path) {
      scope.enter(command);
    }
    return scope;
  }

  /** Move to `command`, a subcommand of the current one. */
  enter(command: Spec | Subcommand): void {
    const parentSubcommands = this.current?.subcommands;
    if (parentSubcommands) {
      const persistent = parentSubcommands.filter((subcommand) => subcommand.isPersistent);
      if (persistent.length > 0) {
        this.inheritedSubcommands.unshift(...persistent);
      }
    }
    this.current = command;
    this.argsMin = getMinArgs(command.args);
    this.argsMax = getMaxArgs(command.args);
    this.local.length = 0;
    if (command.options) {
      for (const option of command.options) {
        (option.isPersistent ? this.persistent : this.local).push(option);
      }
    }
    applyDirectives(this.directives, command);
  }

  /** The current command. */
  get command(): Spec | Subcommand {
    if (!this.current) {
      throw new Error("The scope hasn't entered a command");
    }
    return this.current;
  }

  /** Whether the current command has subcommands of its own or inherits any. */
  get hasSubcommands(): boolean {
    return this.current?.subcommands !== undefined || this.inheritedSubcommands.length > 0;
  }

  /**
   * The subcommands the next token can name: the current command's own,
   * followed by each inherited one that an earlier one doesn't shadow a name
   * of. Hidden ones are included.
   */
  subcommands(): readonly Subcommand[] {
    const own = this.current?.subcommands ?? [];
    if (this.inheritedSubcommands.length === 0) {
      return own;
    }
    const all = [...own];
    for (const candidate of this.inheritedSubcommands) {
      if (!asArray(candidate.name).some((name) => all.some((earlier) => hasName(earlier.name, name)))) {
        all.push(candidate);
      }
    }
    return all;
  }

  /**
   * Find the subcommand `token` names: one of the current command's own, or
   * else an inherited persistent one. An exact name always wins. With
   * `subcommandsMatchUniquePrefix`, a token that's a prefix of exactly one of
   * the command's own names matches that command, unless `exactOnly`. A hidden
   * or inherited command only matches its exact name, so it can't make a
   * visible command's prefix ambiguous or take a prefix meant as an argument,
   * and an empty token is no command's prefix.
   */
  matchSubcommand(token: string, exactOnly = false): SubcommandMatch {
    const own = this.current?.subcommands ?? [];
    for (const candidate of own) {
      if (hasName(candidate.name, token)) {
        return { command: candidate };
      }
    }
    for (const candidate of this.inheritedSubcommands) {
      if (hasName(candidate.name, token)) {
        return { command: candidate };
      }
    }
    const allowPrefix = this.directives.subcommandsMatchUniquePrefix && !exactOnly;
    const matches = allowPrefix ? prefixMatches(own, token) : [];
    if (matches.length === 1) {
      return { command: matches[0] };
    }
    return new NoSubcommand(this.subcommands(), token, matches);
  }

  /** The option `name` refers to, if any. */
  resolve(name: string): Option | null {
    const { local, persistent } = this;
    for (let i = local.length - 1; i >= 0; i--) {
      if (hasName(local[i].name, name)) {
        return local[i];
      }
    }
    for (let i = persistent.length - 1; i >= 0; i--) {
      if (hasName(persistent[i].name, name)) {
        return persistent[i];
      }
    }
    return null;
  }

  /**
   * The options that can be used here, in definition order, each with only
   * its live names: the names that still refer to it. Options with every name
   * shadowed are left out. Where the next token can name a subcommand, as
   * `subcommands` says, a name that one matches is that subcommand's.
   */
  live(subcommands: SubcommandMatching | null = null): {
    local: VisibleOption[];
    persistent: VisibleOption[];
  } {
    // Which option each name refers to, built in one pass so the later and the
    // local options overwrite the ones they shadow. Same answer as `resolve`.
    const owner = new Map<string, Option>();
    for (const options of [this.persistent, this.local]) {
      for (const option of options) {
        for (const name of asArray(option.name)) {
          owner.set(name, option);
        }
      }
    }
    const pick = (options: readonly Option[]) => {
      const picked: VisibleOption[] = [];
      for (const option of options) {
        const names = asArray(option.name).filter(
          (name) =>
            owner.get(name) === option &&
            !(subcommands && this.matchSubcommand(name, subcommands.exactOnly).command),
        );
        if (names.length > 0) {
          picked.push({ option, names });
        }
      }
      return picked;
    };
    return { local: pick(this.local), persistent: pick(this.persistent) };
  }

  /**
   * The options a user can see at the start of the current command: the
   * {@link live} ones that aren't hidden, without the names a subcommand takes.
   */
  visible(): { local: VisibleOption[]; persistent: VisibleOption[] } {
    const { local, persistent } = this.live(this.hasSubcommands ? { exactOnly: false } : null);
    const shown = (visible: VisibleOption) => !visible.option.hidden;
    return { local: local.filter(shown), persistent: persistent.filter(shown) };
  }

  /** The live names of each option a user could have meant, for "did you mean" suggestions. */
  suggestionNames(): string[][] {
    const { local, persistent } = this.live();
    const shown = (visible: VisibleOption) => !visible.option.hidden;
    return [...local, ...persistent].filter(shown).map((visible) => visible.names);
  }

  /** The options that must be used, local first. */
  required(): Option[] {
    return [...this.local, ...this.persistent].filter((option) => option.isRequired);
  }

  /*
   * How an option is written with its value, and how the parser splits a
   * token into an option name and a value. Both use the option arg separators
   * in effect, so what help shows and completion offers is what the parser
   * reads, as long as every separator an option requires is one of them. The
   * spec checker reports one that isn't.
   */

  /**
   * How each of `names` is written with `option`'s value here. Help shows
   * these, completion offers them, and the spec checker reads each one back
   * through the parser.
   */
  forms(option: Option, names: readonly string[] = asArray(option.name)): OptionForm[] {
    const join = (name: string): string | null => {
      if (getMaxArgs(option.args) === 0) {
        return null;
      }
      if (option.requiresSeparator) {
        return this.requiredSeparator(option);
      }
      const glued = !this.directives.flagsArePosixNoncompliant && (name === "-" || name === "+");
      return glued ? "" : null;
    };
    return names.map((name) => ({ name, join: join(name) }));
  }

  /**
   * The separator that must come between `option` and its value, or null if
   * it can take a value as a separate token.
   */
  requiredSeparator(option: Option): string | null {
    const required = option.requiresSeparator;
    if (typeof required === "string") {
      return required;
    }
    return required ? (this.directives.optionArgSeparators[0] ?? "=") : null;
  }

  /** Whether the parser splits an option from its value at `separator` here. */
  readsSeparator(separator: string): boolean {
    return this.directives.optionArgSeparators.includes(separator);
  }

  /** The separator that `text` starts with, or "" if none. Used after a short option. */
  leadingSeparator(text: string): string {
    for (const separator of this.directives.optionArgSeparators) {
      if (text.startsWith(separator)) {
        return separator;
      }
    }
    return "";
  }

  /**
   * The separator that appears first in `token`, so the value after it can
   * contain the other separators. When two separators start at the same place,
   * the longer one wins. Null if there's none, or if the one found is empty.
   */
  firstSeparator(token: string): { index: number; separator: string } | null {
    let found = "";
    let index = -1;
    for (const candidate of this.directives.optionArgSeparators) {
      const at = token.indexOf(candidate);
      if (at === -1) {
        continue;
      }
      if (index === -1 || at < index || (at === index && candidate.length > found.length)) {
        found = candidate;
        index = at;
      }
    }
    return found ? { index, separator: found } : null;
  }

  /**
   * Why `option`, used as `name`, can't take a value given after `separator`,
   * or null if it can. A separate token has the separator "".
   */
  separatorProblem(option: Option, name: string, separator: string): string | null {
    const required = option.requiresSeparator;
    if (typeof required === "string" && separator !== required) {
      return `Incorrect separator, use '${required}' instead of '${separator}'`;
    }
    if (required === true && separator === "") {
      return `Missing separator, use '${this.requiredSeparator(option)}' between ${name} and its value`;
    }
    return null;
  }
}

const optionKeys = new WeakMap<Option, string>();

/**
 * A key for the set of `option`'s names. Options with the same names, in any
 * order, get the same key and are one option: the parser continues a
 * repeatable option's uses across them, counts one as used when the other was,
 * and stores their values under the same names, which is how they're read.
 * Options that share only some names are different options, and each shared
 * name refers to whichever one `resolve` picks.
 */
export function optionKey(option: Option): string {
  let key = optionKeys.get(option);
  if (key === undefined) {
    key = typeof option.name === "string" ? option.name : [...option.name].sort().join("\0");
    optionKeys.set(option, key);
  }
  return key;
}

function hasName(names: string | readonly string[], name: string): boolean {
  return typeof names === "string" ? names === name : names.includes(name);
}

/** The visible commands that `token` is a prefix of a name of, each listed once. */
function prefixMatches(subcommands: readonly Subcommand[], token: string): Subcommand[] {
  if (token === "") {
    return [];
  }
  return subcommands.filter(
    (candidate) => !candidate.hidden && asArray(candidate.name).some((name) => name.startsWith(token)),
  );
}
