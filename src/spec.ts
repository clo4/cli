/**
 * `spec` and `command`: the same plain objects as `Spec` and `Subcommand`,
 * with each command's action typed from the command's own `args` and
 * `options`.
 *
 * Both functions return their argument. Everything else here is types.
 *
 * @module
 */

import type { ActionInit, CommandBody, Spec, Subcommand } from "./types.js";

type Result = Promise<number | void> | number | void;

/** A value in a list, or the value itself where the schema allows either. */
type Element<T> = T extends readonly (infer E)[] ? E : T;

type AsArray<T> = T extends readonly unknown[] ? T : T extends undefined ? [] : [T];

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

// What an action receives {{{

/**
 * Whether the fields that decide how many values an argument takes might be
 * set without the type saying so. That's the case for an argument typed `Arg`,
 * or spread from one, where each field is `true | undefined`.
 */
type Unsure<A> = A extends unknown
  ? undefined extends A[keyof A & ("isOptional" | "isVariadic" | "default")]
    ? true
    : never
  : never;

/**
 * The positional arguments a command's action receives. `Defaults` is whether
 * every optional argument so far has a default. The parser adds defaults up to
 * the first optional argument without one, so an argument after that can be
 * missing even if it has a default of its own.
 */
type Positionals<A, Defaults extends boolean = true> = A extends readonly [infer H, ...infer R]
  ? H extends { isVariadic: true }
    ? H extends { isOptional: true }
      ? string[]
      : [string, ...string[]]
    : H extends { isOptional: true }
      ? H extends { default: string }
        ? Defaults extends true
          ? [string, ...Positionals<R, true>]
          : [string?, ...Positionals<R, false>]
        : [string?, ...Positionals<R, false>]
      : [string, ...Positionals<R, Defaults>]
  : A extends readonly []
    ? []
    : string[];

/** The `args` of the action of command `Y`. A command that requires a subcommand takes none. */
type ArgsOf<Y> = Y extends { requiresSubcommand: true }
  ? []
  : Y extends { args: infer A }
    ? [Unsure<Element<A>>] extends [never]
      ? Positionals<AsArray<A>>
      : string[]
    : [];

/** The options command `Y` defines, as a union. */
type OptionsOf<Y> = Y extends { options: infer O } ? Element<O> : never;

/**
 * The options of `O` that descendants inherit. An option typed `Option` might
 * be persistent without its type saying so, and counts.
 */
type Persistent<O> = O extends { isPersistent: true }
  ? O
  : O extends { isPersistent?: infer P }
    ? unknown extends P
      ? never
      : undefined extends P
        ? O
        : never
    : never;

/** What an option can be read by: its names, and its ref if it has one. */
type NamesOf<O> = O extends { name: infer N }
  ? (N extends readonly string[] ? N[number] : N) | (O extends { ref: infer R extends string } ? R : never)
  : never;

/** The names and refs of `O` that are written out in the spec. */
type Known<O> = NamesOf<O> extends infer N ? (string extends N ? never : N) : never;

/**
 * A name to read an option by. Where every option in scope has its names
 * written out, only those names. An option typed `Option` could have any name,
 * so with one in scope any string is accepted, and the known names are still
 * suggested.
 */
type Name<O> = string extends NamesOf<O> ? Known<O> | (string & {}) : Known<O>;

type Named<O, K> = O extends unknown ? (K extends Known<O> ? O : never) : never;

/** What `get` returns for option `O`. */
type Get<O> = O extends { args: infer A }
  ? AsArray<A> extends readonly [infer H, ...unknown[]]
    ? H extends { isOptional: true }
      ? string | undefined
      : H extends { default: string }
        ? string
        : O extends { isRequired: true }
          ? string
          : string | undefined
    : string | undefined
  : undefined;

type Required<A> = A extends readonly [infer H, ...infer R]
  ? H extends { isOptional: true } | { isVariadic: true }
    ? never
    : [string, ...Required<R>]
  : A extends readonly []
    ? []
    : never;

type EveryDefault<A> = A extends readonly [infer H, ...infer R]
  ? H extends { default: string }
    ? EveryDefault<R>
    : false
  : true;

/**
 * What `all` returns for option `O`: one value for each argument where all of
 * them are required and the option must have been used or every argument has
 * a default, and a list otherwise.
 */
type All<O> = O extends { isRepeatable: true | number }
  ? string[]
  : O extends { args: infer A }
    ? [Unsure<Element<A>>] extends [never]
      ? [Required<AsArray<A>>] extends [never]
        ? string[]
        : O extends { isRequired: true }
          ? Required<AsArray<A>>
          : EveryDefault<AsArray<A>> extends true
            ? Required<AsArray<A>>
            : string[]
      : string[]
    : string[];

/** The options an action can read: its command's own, and the persistent ones above it. */
interface OptionsFor<O> {
  /** Escape hatch: the underlying map of option names to values. */
  readonly options: Map<string, string[]>;

  /** Every argument supplied to an option, or the defaults of its arguments if it wasn't supplied. */
  all<K extends Name<O>>(name: K): [Named<O, K>] extends [never] ? string[] : All<Named<O, K>>;

  /** The first argument supplied to an option, or the default of its first argument if it wasn't supplied. */
  get<K extends Name<O>>(name: K): [Named<O, K>] extends [never] ? string | undefined : Get<Named<O, K>>;

  /** Whether an option was supplied. Defaults don't count. */
  has(name: Name<O>): boolean;

  /** How many values an option has, or how many times a repeatable option without arguments was used. */
  count(name: Name<O>): number;
}

/** What the action of command `Y` receives, below ancestors whose persistent options are `Inherited`. */
interface InitFor<Y, Inherited> extends Omit<ActionInit, "args" | "options"> {
  /** Positional arguments found for the selected command. */
  args: ArgsOf<Y>;

  /** Options found for this invocation. */
  options: OptionsFor<OptionsOf<Y> | Inherited>;
}

// }}}

// Reading a spec {{{

/*
 * TypeScript types a function with unannotated parameters after it has
 * inferred everything else, and it won't infer a value that holds one of
 * those functions. So `Tree` gives each value two readings. `Whole` reads a
 * value in one piece, which works when it holds no such function. The
 * recursion beside it reads the value key by key, or element by element,
 * which works when it does.
 *
 * Three rules keep that working and fast:
 *
 * - No conditional type sits between the root and a nested command, because
 *   TypeScript infers nothing through one. Conditional types only appear as
 *   type arguments and as members of an intersection.
 * - A list is never required to match two tuple types at once. Requiring
 *   that made the check take time in the square of the number of commands.
 * - A command in a list is never read whole, for the same reason.
 */

/**
 * `S` is the schema type for a place in the spec: `Spec`, `Subcommand`,
 * `Option`, `Arg` and so on. A command is a schema with subcommands, and an
 * option is any other schema with an action.
 */
type IsCommand<S> = "subcommands" extends keyof S ? true : false;
type IsOption<S> = "action" extends keyof S ? true : false;

type IsObject<E> = [E] extends [(...args: never[]) => unknown] ? false : [E] extends [object] ? true : false;

/** The schema of the values under key `K`, where they're objects that `Tree` reads one by one. */
type Child<S, K> = K extends keyof S
  ? IsObject<Element<NonNullable<S[K]>>> extends true
    ? Element<NonNullable<S[K]>>
    : never
  : never;

/** The typed action of command `Y`. */
type Typed<Y, Inherited> = { action?: (init: InitFor<Y, Inherited>) => Result };

/** The action of an option, or of a command whose action was written against `ActionInit`. */
type Loose = { action?: (init: ActionInit) => Result };

type Action<Y, Inherited, S> =
  IsCommand<S> extends true
    ? Y extends { action?: infer F }
      ? unknown extends F
        ? Typed<Y, Inherited>
        : NonNullable<F> extends (init: ActionInit) => Result
          ? Loose
          : Typed<Y, Inherited>
      : Typed<Y, Inherited>
    : IsOption<S> extends true
      ? Loose
      : unknown;

/**
 * The fields of `S` that `Tree` doesn't read one by one, with their schema
 * types. A field it does read is left open, unless nothing of it could be
 * inferred. Then the schema type gives its callbacks their parameter types.
 */
type Fields<Y, S> = {
  [K in keyof S]: K extends "action"
    ? unknown
    : [Child<S, K>] extends [never]
      ? S[K]
      : K extends keyof Y
        ? unknown extends Y[K]
          ? S[K]
          : unknown
        : unknown;
};

/** A key the schema doesn't have. */
type Unknown<Y, S> = { [K in Exclude<keyof Y, keyof S>]: never };

/**
 * A list the schema says is too short: an empty one where it wants at least
 * one element, like `options`, or a list of one where it wants the element
 * written without the list, like `args`. A list with a spread in it has no
 * known length, and passes.
 */
type TooShort<Y, S> = {
  [K in Extract<keyof Y, keyof S>]?: [Child<S, K>] extends [never]
    ? unknown
    : Y[K] extends readonly []
      ? [] extends NonNullable<S[K]>
        ? unknown
        : never
      : Y[K] extends readonly [unknown]
        ? [Child<S, K>] extends NonNullable<S[K]>
          ? unknown
          : never
        : unknown;
};

/** What an object with schema `S` has to be, beyond what `Tree` reads its keys for. */
type Checked<Y, Inherited, S> = [S] extends [never]
  ? unknown
  : Action<Y, Inherited, S> & Fields<Y, S> & Unknown<Y, S> & TooShort<Y, S>;

/** `V` read in one piece, as an element or field of `X`. */
type Whole<X, V, S> = V extends object
  ? unknown
  : X extends readonly unknown[]
    ? IsCommand<S> extends true
      ? unknown
      : V
    : V;

/** `S` is the schema of `X`, or of the elements of `X` where it's a list. */
type Tree<X, Inherited, S> = {
  [I in keyof X]: Whole<X, X[I], S> &
    Tree<X[I], Inherited | Persistent<OptionsOf<X>>, X extends readonly unknown[] ? S : Child<S, I>>;
} & (X extends readonly unknown[] | Primitive ? unknown : Checked<X, Inherited, S>);

// }}}

/**
 * Define a CLI. Takes the same object as `Spec` and returns it.
 *
 * Each command's `action` receives `args` and `options` typed from that
 * command, at any depth: the positional arguments as a tuple, and the names
 * of the command's own options and of the persistent options above it.
 */
export function spec<const T>(spec: Tree<T, never, Spec>): Spec {
  return spec as unknown as Spec;
}

/**
 * Define a command outside the spec that uses it. Takes the same object as
 * `Subcommand`, or as `CommandBody` for a `loadSpec` to return, and returns it.
 *
 * Its actions are typed like the ones in {@link spec}, except that they can't
 * see the persistent options of the commands it's placed under.
 */
export function command<const T>(
  command: Tree<T, never, T extends { name: unknown } ? Subcommand : CommandBody>,
): T extends { name: unknown } ? Subcommand : CommandBody {
  return command as never;
}
