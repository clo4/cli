import type { Option, Spec, Subcommand } from "./types.js";
import type { Token } from "./parse.js";
import {
  ambiguousCommand,
  emptyCommand,
  incorrectSeparator,
  missingSeparator,
  unknownCommand,
} from "./errors.js";
import type { DidYouMean } from "./errors.js";
import { argAt, hasParse, maxArgs, minArgs } from "./args.js";
import { asArray } from "./util.js";

/** The parser directives in effect for a command, with defaults filled in. */
export interface Directives {
  optionArgSeparators: readonly string[];
  flagsArePosixNoncompliant: boolean;
  optionsMustPrecedeArguments: boolean;
  subcommandsMatchUniquePrefix: boolean;
}

/** The directives that are switches, which a command turns on or off. */
const switches = [
  "flagsArePosixNoncompliant",
  "optionsMustPrecedeArguments",
  "subcommandsMatchUniquePrefix",
] as const;

/**
 * How the next word can match a subcommand: by any name the command's
 * directives allow, or only by an exact name.
 */
export interface SubcommandMatching {
  readonly exactOnly: boolean;
}

/** Match a subcommand by any name the directives allow. */
export const anyName: SubcommandMatching = { exactOnly: false };
/** Match a subcommand by its exact name only. */
export const exactName: SubcommandMatching = { exactOnly: true };

/** An option that can be used here, and how each name that still refers to it is written. */
export interface LiveOption {
  option: Option;
  forms: OptionForm[];
}

/** A subcommand the next word can name, and the names that still refer to it. */
export interface LiveSubcommand {
  command: Subcommand;
  names: readonly string[];
}

/** How one name of an option is written with its value, at one command. */
export interface OptionForm {
  name: string;
  /**
   * What joins the name to the option's first value in the same word, or null
   * if the value is the next word. It's the required separator for an option
   * that requires one, and "" for an option named "-" or "+", which reads its
   * value straight after the name, like `-5`. It's null for an option without
   * arguments.
   */
  join: string | null;
}

/**
 * What a name means at one command on a path: the options, subcommands,
 * directives and argument limits in effect there. It keeps the path, and
 * moves along it one subcommand at a time, loading each that has a
 * `loadSpec`.
 *
 * Moving to a subcommand replaces the local options and adds its persistent
 * options to the inherited ones. A name refers to one option: a local option
 * wins over a persistent one, and a later option wins over an earlier one in
 * the same list. A subcommand wins over an option where the next word can
 * name a subcommand. The parser, help, completion and the spec checker all
 * ask this module what a name refers to, so they can't disagree.
 */
export class CommandScope<Root extends Spec | Subcommand = Spec | Subcommand> {
  /**
   * The commands from the root to the current one. A command that has a
   * `loadSpec` is on it as the command that loaded in its place.
   */
  readonly path: readonly [Root, ...Subcommand[]];
  /** {@link path}, which only this class adds to. */
  private readonly commands: [Root, ...Subcommand[]];
  /** The current command, the last one on {@link path}. */
  command: Root | Subcommand;
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
  readonly directives: Directives = {
    optionArgSeparators: ["="],
    flagsArePosixNoncompliant: false,
    optionsMustPrecedeArguments: false,
    subcommandsMatchUniquePrefix: false,
  };
  /** Whether the current command has subcommands of its own or inherits any. */
  hasSubcommands = false;
  /** Whether an option in effect here is required. */
  hasRequiredOption = false;
  /** Whether an option in effect here has a parser. */
  hasParse = false;
  // The same for the persistent options, which stay in effect below the
  // command that defines them, while each command's local options don't.
  private persistentRequired = false;
  private persistentParse = false;
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
  constructor(root: Root) {
    this.path = this.commands = [root];
    this.command = root;
    this.select(root);
  }

  /**
   * The scope at the last command on `path`. A command on the path that isn't
   * loaded is loaded first. Throws if its `loadSpec` gives a promise, since
   * the scope can't say what's in effect until it settles.
   */
  static at<Root extends Spec | Subcommand>(path: readonly [Root, ...Subcommand[]]): CommandScope<Root> {
    const scope = new CommandScope(path[0]);
    for (let i = 1; i < path.length; i++) {
      scope.enterNow(path[i]);
    }
    return scope;
  }

  /**
   * {@link enter} for a caller that can't wait: throws if the `loadSpec` of
   * `command` gives a promise.
   */
  enterNow(command: Subcommand): void {
    const loading = this.enter(command);
    if (loading) {
      throw notLoaded(loading, command);
    }
  }

  /**
   * Move to `command`, a subcommand of the current one. A command with a
   * `loadSpec` is loaded first, and the scope moves to the command that
   * stands in its place. If the `loadSpec` gives a
   * promise, so does this, and the scope stays at the current command until
   * it settles.
   */
  enter(command: Subcommand): Promise<void> | null {
    if (command.loadSpec !== undefined) {
      const loaded = loadCommand(command);
      if (loaded instanceof Promise) {
        return loaded.then((whole) => this.move(whole));
      }
      command = loaded;
    }
    this.move(command);
    return null;
  }

  /** Make `command`, a subcommand of the current one, the current command. */
  private move(command: Subcommand): void {
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
    this.commands.push(command);
    this.command = command;
    this.select(command);
  }

  /** Take the argument limits, options and directives of `command`, the new current command. */
  private select(command: Spec | Subcommand): void {
    this.hasSubcommands = command.subcommands !== undefined || this.inheritedSubcommands.length > 0;
    this.argsMin = minArgs(command.args);
    this.argsMax = maxArgs(command.args);
    this.argsLimit = command.requiresSubcommand === true ? 0 : this.argsMax;
    this.local.length = 0;
    let localRequired = false;
    let localParse = false;
    const options = command.options;
    if (options) {
      for (let i = 0; i < options.length; i++) {
        const option = options[i];
        const required = Boolean(option.isRequired);
        const parses = hasParse(option.args);
        if (option.isPersistent) {
          this.persistent.push(option);
          this.persistentRequired ||= required;
          this.persistentParse ||= parses;
        } else {
          this.local.push(option);
          localRequired ||= required;
          localParse ||= parses;
        }
      }
    }
    this.hasRequiredOption = this.persistentRequired || localRequired;
    this.hasParse = this.persistentParse || localParse;
    const configured = command.parserDirectives;
    if (configured) {
      const directives = this.directives;
      if (configured.optionArgSeparators) {
        directives.optionArgSeparators = asArray(configured.optionArgSeparators);
      }
      for (const key of switches) {
        const value = configured[key];
        if (typeof value === "boolean") {
          directives[key] = value;
        }
      }
    }
  }

  /**
   * The subcommands the next word can name, each with the names that still
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

  /**
   * Why `word` names no subcommand here, as an error message and suggestions.
   * It's for a word {@link token} read as no subcommand, matched the same
   * way.
   */
  unmatched(word: string, exactOnly: boolean): { message: string; didYouMean?: DidYouMean } {
    const allowPrefix = this.directives.subcommandsMatchUniquePrefix && !exactOnly;
    const prefixOf = allowPrefix ? prefixMatches(this.command.subcommands ?? [], word) : [];
    return unmatchedReason(word, prefixOf, this.subcommands());
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
   * The option in scope whose ref is `ref`, if any. An option with a ref
   * shares a name with another option, so {@link resolve} may not find it by
   * name.
   */
  withRef(ref: string): Option | null {
    for (const option of this.local.concat(this.persistent)) {
      if (option.ref === ref) {
        return option;
      }
    }
    return null;
  }

  /**
   * The token `word` is here: the subcommand it names, the options it uses, or
   * null for an argument or a value. `subcommands` says how the word can name
   * a subcommand, or is null if it can't, and `options` says whether it can
   * be an option. A subcommand wins over an option.
   *
   * The word names one of the current command's own subcommands, or else an
   * inherited persistent one. An exact name always wins. With
   * `subcommandsMatchUniquePrefix`, a word that's a prefix of exactly one of
   * the command's own names matches that command, unless `exactOnly`. A hidden
   * or inherited command only matches its exact name, so it can't make a
   * visible command's prefix ambiguous or take a prefix meant as an argument,
   * and an empty word is no command's prefix.
   *
   * A word written like an option whose first name refers to no option is
   * still options, with a null option for that name. The parser reads it as
   * an unknown option, or as a value if the open option has room for one.
   */
  token(
    word: string,
    subcommands: SubcommandMatching | null,
    options: boolean,
  ): Extract<Token, { kind: "subcommand" | "options" }> | null {
    if (subcommands) {
      const own = this.command.subcommands;
      if (own) {
        for (let i = 0; i < own.length; i++) {
          if (hasName(own[i].name, word)) {
            return { kind: "subcommand", command: own[i] };
          }
        }
      }
      if (this.inheritedSubcommands.length > 0 || this.directives.subcommandsMatchUniquePrefix) {
        const command = this.otherSubcommand(word, subcommands.exactOnly);
        if (command) {
          return { kind: "subcommand", command };
        }
      }
    }
    if (!options) {
      return null;
    }
    const { optionArgSeparators: separators, flagsArePosixNoncompliant: noncompliant } = this.directives;
    const first = word.charCodeAt(0);
    const isDoubleDash = first === 45 /* - */ && word.charCodeAt(1) === 45;

    if (!noncompliant && word.length > 1 && (first === 45 || first === 43) /* + */ && !isDoubleDash) {
      return this.shortOptions(word);
    }

    if (!noncompliant && !(word.length > 2 && isDoubleDash)) {
      return null;
    }
    // A word like `--name` or `--name=value`, or any word when options
    // aren't POSIX compliant. The separator that appears first splits it, so
    // the value can contain the other separators. When two separators start
    // at the same place, the longer one wins.
    let separator = "";
    let index = -1;
    for (let i = 0; i < separators.length; i++) {
      const candidate = separators[i];
      const at = word.indexOf(candidate);
      if (
        at !== -1 &&
        (index === -1 || at < index || (at === index && candidate.length > separator.length))
      ) {
        separator = candidate;
        index = at;
      }
    }
    const name = separator ? word.slice(0, index) : word;
    const option = this.resolve(name);
    // When options aren't POSIX compliant, no word looks like an option, so
    // one that isn't an option is an argument.
    if (!option && noncompliant) {
      return null;
    }
    const attached =
      option && separator ? { start: index + separator.length, separator, arg: argAt(option.args, 0) } : null;
    return { kind: "options", uses: [{ option, name }], attached };
  }

  /**
   * The inherited subcommand `word` names, or else the subcommand of the
   * current command that `word` is a unique prefix of, when prefixes match.
   * See {@link token}. It's a method of its own so that a cold parse of a
   * spec without persistent subcommands or prefix matching doesn't compile it.
   */
  private otherSubcommand(word: string, exactOnly: boolean): Subcommand | null {
    const inherited = this.inheritedSubcommands;
    for (let i = 0; i < inherited.length; i++) {
      if (hasName(inherited[i].name, word)) {
        return inherited[i];
      }
    }
    if (this.directives.subcommandsMatchUniquePrefix && !exactOnly) {
      const matches = prefixMatches(this.command.subcommands ?? [], word);
      if (matches.length === 1) {
        return matches[0];
      }
    }
    return null;
  }

  /**
   * The token a word like `-abc`, `+x` or `-ovalue` is. See {@link token}.
   * It's a method of its own so that a cold parse of a line without one
   * doesn't compile it.
   */
  private shortOptions(word: string): Extract<Token, { kind: "options" }> {
    const separators = this.directives.optionArgSeparators;
    // A single dash or plus option takes the rest of the word as its value
    // if it takes arguments and the first character after it isn't an option.
    const leadingChar = word[0];
    const dashOption = this.resolve(leadingChar);
    if (dashOption?.args && !this.resolve(word.slice(0, 2))) {
      return {
        kind: "options",
        uses: [{ option: dashOption, name: leadingChar }],
        attached: { start: 1, separator: "", arg: argAt(dashOption.args, 0) },
      };
    }
    // Otherwise it's chained short options. An option that takes arguments
    // takes the rest of the word as its value, after a separator if one
    // follows. So does an option without arguments that a separator follows,
    // so that `-v=1` fails like `--verbose=1`, unless the next character is
    // an option.
    const uses: { option: Option | null; name: string }[] = [];
    for (let char = 1; char < word.length; char++) {
      const name = leadingChar + word[char];
      const option = this.resolve(name);
      uses.push({ option, name });
      if (!option || char === word.length - 1) {
        continue;
      }
      let separator = "";
      for (let i = 0; i < separators.length; i++) {
        if (word.startsWith(separators[i], char + 1)) {
          separator = separators[i];
          break;
        }
      }
      if (option.args || (separator && !this.resolve(leadingChar + word[char + 1]))) {
        return {
          kind: "options",
          uses,
          attached: { start: char + separator.length + 1, separator, arg: argAt(option.args, 0) },
        };
      }
    }
    return { kind: "options", uses, attached: null };
  }

  /**
   * The options that can be used here, in definition order, each with the
   * forms of its live names: the names that still refer to it. Options with
   * every name shadowed are left out. Where the next word can name a
   * subcommand, as `subcommands` says, a name that one matches is that
   * subcommand's.
   */
  live(subcommands: SubcommandMatching | null = null): { local: LiveOption[]; persistent: LiveOption[] } {
    return this.liveOptions(subcommands, true);
  }

  /**
   * The options a user can see at the start of the current command: the
   * {@link live} ones that aren't hidden, without the names a subcommand takes.
   */
  visible(): { local: LiveOption[]; persistent: LiveOption[] } {
    return this.liveOptions(this.hasSubcommands ? anyName : null, false);
  }

  /** The live names of each option a user could have meant, for "did you mean" suggestions. */
  suggestionNames(): string[][] {
    const { local, persistent } = this.liveOptions(null, false);
    const names: string[][] = [];
    for (const { forms } of local.concat(persistent)) {
      names.push(forms.map((form) => form.name));
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
  ): { local: LiveOption[]; persistent: LiveOption[] } {
    const { local, persistent } = this;
    if (local.length === 0 && persistent.length === 0) {
      return { local: [], persistent: [] };
    }
    // Which option each name refers to, built in one pass so the later and the
    // local options overwrite the ones they shadow. Same answer as `resolve`.
    const owner = new Map<string, Option>();
    for (const option of persistent.concat(local)) {
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

  /** Each of `options` with the forms of its live names, as {@link liveOptions} lists them. */
  private pickLive(
    options: readonly Option[],
    owner: ReadonlyMap<string, Option>,
    subcommands: SubcommandMatching | null,
    hidden: boolean,
  ): LiveOption[] {
    const picked: LiveOption[] = [];
    for (let i = 0; i < options.length; i++) {
      const option = options[i];
      if (option.hidden && !hidden) {
        continue;
      }
      const names = asArray(option.name);
      const forms: OptionForm[] = [];
      for (let j = 0; j < names.length; j++) {
        const name = names[j];
        if (
          owner.get(name) === option &&
          !(subcommands && this.token(name, subcommands, false)?.kind === "subcommand")
        ) {
          forms.push({ name, join: this.join(option, name) });
        }
      }
      if (forms.length > 0) {
        picked.push({ option, forms });
      }
    }
    return picked;
  }

  /*
   * How an option is written with its value, and how the parser splits a
   * word into an option name and a value. Both use the option arg separators
   * in effect, so what help shows and completion offers is what the parser
   * reads, as long as every separator an option requires is one of them. The
   * spec checker reports one that isn't.
   */

  /**
   * What joins `option`, written as `name`, to its first value here. See
   * {@link OptionForm.join}. Help shows the forms, completion offers them,
   * and the spec checker reads each one back through the parser.
   * {@link formStart} and {@link writeForm} turn a form into words.
   */
  private join(option: Option, name: string): string | null {
    if (maxArgs(option.args) === 0) {
      return null;
    }
    if (option.requiresSeparator) {
      return this.requiredSeparator(option);
    }
    return !this.directives.flagsArePosixNoncompliant && (name === "-" || name === "+") ? "" : null;
  }

  /**
   * The separator that must come between `option` and its value, or null if
   * it can take a value as a separate word.
   */
  requiredSeparator(option: Option): string | null {
    const required = option.requiresSeparator;
    return required === true ? this.firstSeparator : (required ?? null);
  }

  /** The separator an option that requires any of them is written with: the first one in effect. */
  private get firstSeparator(): string {
    return this.directives.optionArgSeparators[0] ?? "=";
  }

  /**
   * Why `option`, used as `name`, can't take a value given after `separator`,
   * or null if it can. A separate word has the separator "".
   */
  separatorProblem(option: Option, name: string, separator: string): string | null {
    const required = option.requiresSeparator;
    if (required === true) {
      return separator === "" ? missingSeparator(this.firstSeparator, name) : null;
    }
    if (required !== undefined && separator !== required) {
      return incorrectSeparator(required, separator);
    }
    return null;
  }
}

/**
 * Call the `loadSpec` of `stub` and give the command the parser carries on
 * with in its place, as a native promise only if `loadSpec` gave one. It's a function
 * of its own so that a cold parse of a spec without `loadSpec` doesn't compile
 * it.
 */
function loadCommand(stub: Subcommand): Subcommand | Promise<Subcommand> {
  const loaded = stub.loadSpec!();
  return typeof (loaded as Promise<Subcommand>).then === "function"
    ? Promise.resolve(loaded).then((whole) => inPlaceOf(stub, whole))
    : inPlaceOf(stub, loaded as Subcommand);
}

/**
 * What a command with a `loadSpec` sets: what its parent reads before the
 * command loads. A parent's help and completion have shown these, so they're
 * the ones used.
 */
export const stubKeys = ["name", "description", "hidden", "isPersistent"] as const;

/**
 * The command that stands in place of `stub` once its `loadSpec` has given
 * `loaded`: everything `loaded` has, under each of the {@link stubKeys} that
 * `stub` sets. Neither object is changed.
 */
function inPlaceOf(stub: Subcommand, loaded: Subcommand): Subcommand {
  const whole: Subcommand = { ...loaded, loadSpec: undefined };
  for (const key of stubKeys) {
    if (stub[key] !== undefined) {
      Object.assign(whole, { [key]: stub[key] });
    }
  }
  return whole;
}

/**
 * The error for reading `command` while it's still `loading`. It's a
 * function of its own so that a run that never does doesn't compile it.
 */
function notLoaded(loading: Promise<void>, command: Subcommand): Error {
  // Nobody waits for the load, so it mustn't become an unhandled rejection.
  loading.catch(() => {});
  const name = asArray(command.name)[0];
  return new Error(
    `The command '${name}' isn't loaded, and its loadSpec returned a promise to wait for first`,
  );
}

/**
 * `command` with every command below it loaded, so the spec checks see the
 * whole CLI. It's a copy wherever a command below has a `loadSpec`, and the
 * spec it was given stays as it was. `each` is given the path to each command
 * with a `loadSpec` and the command that gave.
 */
export async function loadAll<C extends Spec | Subcommand>(
  command: C,
  each?: (path: Subcommand[], loaded: Subcommand) => void,
  path: Subcommand[] = [command],
): Promise<C> {
  const subcommands = command.subcommands;
  if (!subcommands) {
    return command;
  }
  let changed = false;
  const all: Subcommand[] = [];
  for (const subcommand of subcommands) {
    let whole = subcommand;
    if (subcommand.loadSpec !== undefined) {
      const loaded = await subcommand.loadSpec();
      each?.([...path, subcommand], loaded);
      whole = inPlaceOf(subcommand, loaded);
    }
    const below = await loadAll(whole, each, [...path, whole]);
    changed ||= below !== subcommand;
    all.push(below);
  }
  return changed ? { ...command, subcommands: all as unknown as C["subcommands"] } : command;
}

/**
 * What a user types of `form` up to its first value: the name, and the join
 * too if the value goes in the same word.
 */
export function formStart(form: OptionForm): string {
  return form.join === null ? form.name : form.name + form.join;
}

/**
 * The words that write `form` with `values`. The first value goes in the
 * name's word if the form joins it, and the rest are words of their own.
 */
export function writeForm(form: OptionForm, values: readonly string[]): string[] {
  if (form.join === null || values.length === 0) {
    return [form.name, ...values];
  }
  return [formStart(form) + values[0], ...values.slice(1)];
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

/**
 * Why `word` names none of `subcommands`. `prefixOf` are the commands it's a
 * prefix of a name of, where prefixes match. There is never exactly one of
 * them, since the word would name that one.
 */
function unmatchedReason(
  word: string,
  prefixOf: readonly Subcommand[],
  subcommands: readonly LiveSubcommand[],
): { message: string; didYouMean?: DidYouMean } {
  if (word === "") {
    return { message: emptyCommand };
  }
  if (prefixOf.length > 0) {
    const possible: string[] = [];
    for (const command of prefixOf) {
      for (const name of asArray(command.name)) {
        if (name.startsWith(word)) {
          possible.push(name);
        }
      }
    }
    return { message: ambiguousCommand(word, possible) };
  }
  const choices: (readonly string[])[] = [];
  for (const { command, names } of subcommands) {
    if (!command.hidden) {
      choices.push(names);
    }
  }
  return { message: unknownCommand(word), didYouMean: { input: word, choices } };
}

/** The visible commands that `word` is a prefix of a name of, each listed once. */
function prefixMatches(subcommands: readonly Subcommand[], word: string): Subcommand[] {
  if (word === "") {
    return [];
  }
  return subcommands.filter(
    (candidate) => !candidate.hidden && asArray(candidate.name).some((name) => name.startsWith(word)),
  );
}
