import type { Option, Spec, Subcommand } from "./types.js";
import { applyDirectives, defaultDirectives } from "./directives.js";
import type { Directives } from "./directives.js";
import { asArray } from "./util.js";

/** An option that can be used here, and the names that still refer to it. */
export interface VisibleOption {
  option: Option;
  names: string[];
}

/**
 * The options and directives in effect at one command on a path.
 *
 * Moving to a subcommand replaces the local options and adds its persistent
 * options to the inherited ones. A name refers to one option: a local option
 * wins over a persistent one, and a later option wins over an earlier one in
 * the same list. The parser, help, completion and the spec checker all ask
 * this module which option a name refers to, so they can't disagree.
 */
export class OptionScope {
  /** Non-persistent options of the current command, in definition order. */
  readonly local: Option[] = [];
  /** Persistent options from every command on the path, in definition order. */
  readonly persistent: Option[] = [];
  /** The directives in effect. A subcommand inherits each until it sets its own. */
  readonly directives: Directives = defaultDirectives();

  /** The scope at the last command on `path`. */
  static at(path: readonly (Spec | Subcommand)[]): OptionScope {
    const scope = new OptionScope();
    for (const command of path) scope.enter(command);
    return scope;
  }

  /** Move to `command`, a subcommand of the current one. */
  enter(command: Spec | Subcommand): void {
    this.local.length = 0;
    if (command.options) {
      for (const option of command.options) {
        (option.isPersistent ? this.persistent : this.local).push(option);
      }
    }
    applyDirectives(this.directives, command);
  }

  /** The option `name` refers to, if any. */
  resolve(name: string): Option | null {
    const { local, persistent } = this;
    for (let i = local.length - 1; i >= 0; i--) {
      if (hasName(local[i].name, name)) return local[i];
    }
    for (let i = persistent.length - 1; i >= 0; i--) {
      if (hasName(persistent[i].name, name)) return persistent[i];
    }
    return null;
  }

  /**
   * The options a user can see here, in definition order, each with only its
   * live names. Hidden options, and options with every name shadowed, are
   * left out.
   */
  visible(): { local: VisibleOption[]; persistent: VisibleOption[] } {
    // Which option each name refers to, built in one pass so the later and the
    // local options overwrite the ones they shadow. Same answer as `resolve`.
    const owner = new Map<string, Option>();
    for (const options of [this.persistent, this.local]) {
      for (const option of options) {
        for (const name of asArray(option.name)) owner.set(name, option);
      }
    }
    const pick = (options: readonly Option[]) => {
      const picked: VisibleOption[] = [];
      for (const option of options) {
        if (option.hidden) continue;
        const names = asArray(option.name).filter((name) => owner.get(name) === option);
        if (names.length > 0) picked.push({ option, names });
      }
      return picked;
    };
    return { local: pick(this.local), persistent: pick(this.persistent) };
  }

  /** Every name a user could have meant, for "did you mean" suggestions. */
  suggestionNames(): string[] {
    const { local, persistent } = this.visible();
    return [...local, ...persistent].flatMap((visible) => visible.names);
  }

  /** The options that must be used, local first. */
  required(): Option[] {
    return [...this.local, ...this.persistent].filter((option) => option.isRequired);
  }

  /**
   * The separator that must come between `option` and its value, or null if
   * it can take a value as a separate token.
   */
  requiredSeparator(option: Option): string | null {
    const required = option.requiresSeparator;
    if (typeof required === "string") return required;
    return required ? (this.directives.optionArgSeparators[0] ?? "=") : null;
  }
}

function hasName(names: string | readonly string[], name: string): boolean {
  return typeof names === "string" ? names === name : names.includes(name);
}
