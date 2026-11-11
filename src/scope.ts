import type { CommandBody, Option, Spec, Subcommand } from "./types.js";
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
  readonly exactOnly: boolean;
}

/** Match a subcommand by any name the directives allow. */
export const anyName: SubcommandMatching = { exactOnly: false };
/** Match a subcommand by its exact name only. */
export const exactName: SubcommandMatching = { exactOnly: true };

/** What a token means at one command. See {@link CommandScope.meaning}. */
export type TokenMeaning =
  | { kind: "subcommand"; command: Subcommand }
  | {
      kind: "options";
      /** Each name the token uses, in order. */
      uses: OptionUse[];
      /**
       * Where the value attached to the last option starts, and the separator
       * before it, which is "" if there's none.
       */
      attached: { start: number; separator: string } | null;
    };

/** A name a token uses, and the option it refers to, or null if none. */
export interface OptionUse {
  option: Option | null;
  name: string;
}

/** An option that can be used here, and the names that still refer to it. */
export interface VisibleOption {
  option: Option;
  names: string[];
}

/** A subcommand the next token can name, and the names that still refer to it. */
export interface LiveSubcommand {
  command: Subcommand;
  names: readonly string[];
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
  /** The current command. */
  command: Spec | Subcommand;
  /** Whether the current command has subcommands of its own or inherits any. */
  hasSubcommands = false;
  /**
   * Whether a command on the path has a required option. It stays true after
   * the scope moves past the command that has it, which only costs a check
   * that finds nothing missing.
   */
  hasRequiredOption = false;
  /** The fewest positional arguments the current command takes. */
  argsMin = 0;
  /** The most positional arguments the current command takes. */
  argsMax = 0;
  /**
   * How many arguments the current command takes before the parser reports
   * one too many. It's `argsMax`, or 0 if the command requires a subcommand.
   */
  argsLimit = 0;

  /** The scope at `root`. */
  constructor(root: Spec | Subcommand) {
    this.command = root;
    this.select(root);
  }

  /** The scope at the last command on `path`. */
  static at(path: readonly (Spec | Subcommand)[]): CommandScope {
    const scope = new CommandScope(path[0]);
    for (let i = 1; i < path.length; i++) {
      scope.enter(path[i]);
    }
    return scope;
  }

  /**
   * Move to `command`, a subcommand of the current one. A command with a
   * `loadSpec` gets its body first, unless `load` is false. If the body is a
   * promise, so is the result, and the scope can't be asked anything until it
   * settles.
   */
  enter(command: Spec | Subcommand, load = true): Promise<void> | null {
    const parentSubcommands = this.command.subcommands;
    if (parentSubcommands) {
      // Nearest first, so these go in front of the ones inherited from above.
      let at = 0;
      for (let i = 0; i < parentSubcommands.length; i++) {
        if (parentSubcommands[i].isPersistent) {
          this.inheritedSubcommands.splice(at++, 0, parentSubcommands[i]);
        }
      }
    }
    this.command = command;
    if ((command as Subcommand).loadSpec !== undefined && load) {
      const loading = loadBody(command as Subcommand);
      if (loading) {
        return loading.then(() => this.select(command));
      }
    }
    this.select(command);
    return null;
  }

  /** Take the argument limits, options and directives of `command`, the new current command. */
  private select(command: Spec | Subcommand): void {
    this.hasSubcommands = command.subcommands !== undefined || this.inheritedSubcommands.length > 0;
    this.argsMin = getMinArgs(command.args);
    this.argsMax = getMaxArgs(command.args);
    this.argsLimit = command.requiresSubcommand === true ? 0 : this.argsMax;
    this.local.length = 0;
    const options = command.options;
    if (options) {
      for (let i = 0; i < options.length; i++) {
        (options[i].isPersistent ? this.persistent : this.local).push(options[i]);
        if (options[i].isRequired) {
          this.hasRequiredOption = true;
        }
      }
    }
    const configured = command.parserDirectives;
    if (configured) {
      applyDirectives(this.directives, configured);
    }
  }

  /**
   * The subcommands the next token can name, each with the names that still
   * refer to it: the current command's own, then the inherited ones, nearest
   * first. Hidden ones are included.
   *
   * A name a nearer subcommand takes is shadowed one name at a time, as it is
   * for options. With an own `x` and an inherited `x`/`y`, the inherited one
   * is still `y`. The other way would drop an inherited subcommand once any of
   * its names is taken, and make the parser refuse its other names too. This
   * way, a name that only one subcommand has keeps working.
   */
  subcommands(): LiveSubcommand[] {
    const own = this.command.subcommands ?? [];
    const live = own.map((command) => ({ command, names: asArray(command.name) }));
    if (this.inheritedSubcommands.length === 0) {
      return live;
    }
    const taken = new Set(live.flatMap(({ names }) => names));
    for (const command of this.inheritedSubcommands) {
      const names = asArray(command.name).filter((name) => !taken.has(name));
      if (names.length > 0) {
        live.push({ command, names });
        for (const name of names) {
          taken.add(name);
        }
      }
    }
    return live;
  }

  /** The subcommand `token` names, or why it names none. See {@link meaning}. */
  matchSubcommand(token: string, exactOnly = false): SubcommandMatch {
    const meaning = this.meaning(token, exactOnly ? exactName : anyName, false);
    if (meaning?.kind === "subcommand") {
      return meaning;
    }
    const allowPrefix = this.directives.subcommandsMatchUniquePrefix && !exactOnly;
    const matches = allowPrefix ? prefixMatches(this.command.subcommands ?? [], token) : [];
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
   * What `token` means here: the subcommand it names, the options it uses, or
   * null for an argument or a value. `subcommands` says how the token can name
   * a subcommand, or is null if it can't, and `options` says whether it can
   * be an option. A subcommand wins over an option.
   *
   * The token names one of the current command's own subcommands, or else an
   * inherited persistent one. An exact name always wins. With
   * `subcommandsMatchUniquePrefix`, a token that's a prefix of exactly one of
   * the command's own names matches that command, unless `exactOnly`. A hidden
   * or inherited command only matches its exact name, so it can't make a
   * visible command's prefix ambiguous or take a prefix meant as an argument,
   * and an empty token is no command's prefix.
   *
   * A token written like an option whose first name refers to no option still
   * means options, with a null option for that name. The parser reads it as
   * an unknown option, or as a value if the open option has room for one.
   */
  meaning(token: string, subcommands: SubcommandMatching | null, options: boolean): TokenMeaning | null {
    if (subcommands) {
      const own = this.command.subcommands;
      if (own) {
        for (let i = 0; i < own.length; i++) {
          if (hasName(own[i].name, token)) {
            return { kind: "subcommand", command: own[i] };
          }
        }
      }
      if (this.inheritedSubcommands.length > 0 || this.directives.subcommandsMatchUniquePrefix) {
        const command = this.otherSubcommand(token, subcommands.exactOnly);
        if (command) {
          return { kind: "subcommand", command };
        }
      }
    }
    if (!options) {
      return null;
    }
    const { optionArgSeparators: separators, flagsArePosixNoncompliant: noncompliant } = this.directives;
    const first = token.charCodeAt(0);
    const isDoubleDash = first === 45 /* - */ && token.charCodeAt(1) === 45;

    if (!noncompliant && token.length > 1 && (first === 45 || first === 43) /* + */ && !isDoubleDash) {
      return this.shortOptions(token);
    }

    if (!noncompliant && !(token.length > 2 && isDoubleDash)) {
      return null;
    }
    // A token like `--name` or `--name=value`, or any token when options
    // aren't POSIX compliant. The separator that appears first splits it, so
    // the value can contain the other separators. When two separators start
    // at the same place, the longer one wins.
    let separator = "";
    let index = -1;
    for (let i = 0; i < separators.length; i++) {
      const candidate = separators[i];
      const at = token.indexOf(candidate);
      if (
        at !== -1 &&
        (index === -1 || at < index || (at === index && candidate.length > separator.length))
      ) {
        separator = candidate;
        index = at;
      }
    }
    const name = separator ? token.slice(0, index) : token;
    const option = this.resolve(name);
    // When options aren't POSIX compliant, no token looks like an option, so
    // one that isn't an option is an argument.
    if (!option && noncompliant) {
      return null;
    }
    const attached = option && separator ? { start: index + separator.length, separator } : null;
    return { kind: "options", uses: [{ option, name }], attached };
  }

  /**
   * The inherited subcommand `token` names, or else the subcommand of the
   * current command that `token` is a unique prefix of, when prefixes match.
   * See {@link meaning}. It's a method of its own so that a cold parse of a
   * spec without persistent subcommands or prefix matching doesn't compile it.
   */
  private otherSubcommand(token: string, exactOnly: boolean): Subcommand | null {
    const inherited = this.inheritedSubcommands;
    for (let i = 0; i < inherited.length; i++) {
      if (hasName(inherited[i].name, token)) {
        return inherited[i];
      }
    }
    if (this.directives.subcommandsMatchUniquePrefix && !exactOnly) {
      const matches = prefixMatches(this.command.subcommands ?? [], token);
      if (matches.length === 1) {
        return matches[0];
      }
    }
    return null;
  }

  /**
   * What a token like `-abc`, `+x` or `-ovalue` means. See {@link meaning}.
   * It's a method of its own so that a cold parse of a line without one
   * doesn't compile it.
   */
  private shortOptions(token: string): TokenMeaning {
    const separators = this.directives.optionArgSeparators;
    // A single dash or plus option takes the rest of the token as its value
    // if it takes arguments and the first character after it isn't an option.
    const leadingChar = token[0];
    const dashOption = this.resolve(leadingChar);
    if (dashOption?.args && !this.resolve(token.slice(0, 2))) {
      return {
        kind: "options",
        uses: [{ option: dashOption, name: leadingChar }],
        attached: { start: 1, separator: "" },
      };
    }
    // Otherwise it's chained short options. An option that takes arguments
    // takes the rest of the token as its value, after a separator if one
    // follows. So does an option without arguments that a separator follows,
    // so that `-v=1` fails like `--verbose=1`, unless the next character is
    // an option.
    const uses: OptionUse[] = [];
    for (let char = 1; char < token.length; char++) {
      const name = leadingChar + token[char];
      const option = this.resolve(name);
      uses.push({ option, name });
      if (!option || char === token.length - 1) {
        continue;
      }
      let separator = "";
      for (let i = 0; i < separators.length; i++) {
        if (token.startsWith(separators[i], char + 1)) {
          separator = separators[i];
          break;
        }
      }
      if (option.args || (separator && !this.resolve(leadingChar + token[char + 1]))) {
        return { kind: "options", uses, attached: { start: char + separator.length + 1, separator } };
      }
    }
    return { kind: "options", uses, attached: null };
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
    return this.liveOptions(subcommands, true);
  }

  /**
   * The options a user can see at the start of the current command: the
   * {@link live} ones that aren't hidden, without the names a subcommand takes.
   */
  visible(): { local: VisibleOption[]; persistent: VisibleOption[] } {
    return this.liveOptions(this.hasSubcommands ? anyName : null, false);
  }

  /** The live names of each option a user could have meant, for "did you mean" suggestions. */
  suggestionNames(): string[][] {
    const { local, persistent } = this.liveOptions(null, false);
    const names: string[][] = [];
    for (let i = 0; i < local.length; i++) {
      names.push(local[i].names);
    }
    for (let i = 0; i < persistent.length; i++) {
      names.push(persistent[i].names);
    }
    return names;
  }

  /**
   * The {@link live} options, without the hidden ones unless `hidden`. A
   * hidden option still shadows the names it takes. It uses loops instead of
   * callbacks because each callback is one more function for V8 to compile,
   * and this runs only a few times a run.
   */
  private liveOptions(
    subcommands: SubcommandMatching | null,
    hidden: boolean,
  ): { local: VisibleOption[]; persistent: VisibleOption[] } {
    const { local, persistent } = this;
    if (local.length === 0 && persistent.length === 0) {
      return { local: [], persistent: [] };
    }
    // Which option each name refers to, built in one pass so the later and the
    // local options overwrite the ones they shadow. Same answer as `resolve`.
    const owner = new Map<string, Option>();
    for (let i = 0; i < persistent.length + local.length; i++) {
      const option = i < persistent.length ? persistent[i] : local[i - persistent.length];
      const names = asArray(option.name);
      for (let j = 0; j < names.length; j++) {
        owner.set(names[j], option);
      }
    }
    return {
      local: this.pickLive(local, owner, subcommands, hidden),
      persistent: this.pickLive(persistent, owner, subcommands, hidden),
    };
  }

  /** Each of `options` with its live names, as {@link liveOptions} lists them. */
  private pickLive(
    options: readonly Option[],
    owner: ReadonlyMap<string, Option>,
    subcommands: SubcommandMatching | null,
    hidden: boolean,
  ): VisibleOption[] {
    const picked: VisibleOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (option.hidden && !hidden) {
        continue;
      }
      const all = asArray(option.name);
      const names: string[] = [];
      for (let j = 0; j < all.length; j++) {
        const name = all[j];
        if (
          owner.get(name) === option &&
          !(subcommands && this.meaning(name, subcommands, false)?.kind === "subcommand")
        ) {
          names.push(name);
        }
      }
      if (names.length > 0) {
        picked.push({ option, names });
      }
    }
    return picked;
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
    const takesArgs = getMaxArgs(option.args) !== 0;
    const forms: OptionForm[] = [];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      let join: string | null = null;
      if (takesArgs) {
        if (option.requiresSeparator) {
          join = this.requiredSeparator(option);
        } else if (!this.directives.flagsArePosixNoncompliant && (name === "-" || name === "+")) {
          join = "";
        }
      }
      forms.push({ name, join });
    }
    return forms;
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

/**
 * Call `command`'s `loadSpec` and merge the body into the command, so every
 * reader of the spec sees one loaded command from then on. Returns a promise
 * only if `loadSpec` did. It's a function of its own so that a cold parse of a
 * spec without `loadSpec` doesn't compile it.
 */
export function loadBody(command: Subcommand): Promise<void> | null {
  const body = command.loadSpec!();
  if (typeof (body as Promise<CommandBody>).then === "function") {
    return Promise.resolve(body).then((loaded) => mergeBody(command, loaded));
  }
  mergeBody(command, body as CommandBody);
  return null;
}

/**
 * Load the body of every command below `command` that has a `loadSpec`, so the
 * spec checks see the whole CLI.
 */
export async function loadAll(command: Spec | Subcommand): Promise<void> {
  for (const subcommand of command.subcommands ?? []) {
    if (subcommand.loadSpec !== undefined) {
      await loadBody(subcommand);
    }
    await loadAll(subcommand);
  }
}

function mergeBody(command: Subcommand, body: CommandBody): void {
  command.loadSpec = undefined;
  Object.assign(command, body);
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
