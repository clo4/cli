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

/** The names of the options in `O`. */
type NamesOf<O> = O extends { name: infer N } ? (N extends readonly string[] ? N[number] : N) : never;

/**
 * What the options in `O` can be read by: their names, and the ref of each
 * one that has one.
 *
 * This and the other types an editor shows are written as conditional types.
 * TypeScript shows the result of a conditional type, and shows any other
 * alias by its name and arguments, which here would be every option's
 * definition.
 */
type KeysOf<O> = O extends unknown
  ? NamesOf<O> | (O extends { ref: infer R extends string } ? R : never)
  : never;

/** `N` without `string`, which is the name of an option whose names aren't written out in the spec. */
type Written<N> = N extends unknown ? (string extends N ? never : N) : never;

/**
 * `N`, as what a caller can pass. Where every option in scope has its names
 * written out, only those names. An option typed `Option` could have any name,
 * so with one in scope any string is accepted, and the written names are still
 * suggested.
 */
type OneOf<N> = string extends N ? Written<N> | (string & {}) : N;

/** A name or ref to read an option in `O` by. */
type Name<O> = OneOf<KeysOf<O>>;

/** The options in `O` that take a value. An option typed `Option` might. */
type Valued<O> = O extends { args: object } ? O : string extends NamesOf<O> ? O : never;

/** A name or ref to read the value of an option in `O` by. A flag has no value to read. */
type ValueName<O> = OneOf<KeysOf<Valued<O>>>;

/** A name of an option in `O`, for another option to refer to it by. */
type Referred<O> = OneOf<NamesOf<O>>;

type Named<O, K> = O extends unknown ? (K extends Written<KeysOf<O>> ? O : never) : never;

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

/**
 * The options an action can read. Its type arguments are worked out from the
 * options before they get here, so that an editor shows the names and what
 * each one gives, and not every option's definition.
 *
 * - `Name`: what any option can be read by.
 * - `ValueName`: what an option with a value can be read by.
 * - `Value`: what `get` returns, for each of those.
 * - `Values`: what `all` returns, for each of those.
 */
interface OptionReader<Name, ValueName, Value, Values> {
  /** Escape hatch: the underlying map of option names to values. */
  readonly options: Map<string, string[]>;

  /** Every argument supplied to an option, or the defaults of its arguments if it wasn't supplied. */
  all<K extends Name>(name: WithValue<K, ValueName>): K extends keyof Values ? Values[K] : string[];

  /** The first argument supplied to an option, or the default of its first argument if it wasn't supplied. */
  get<K extends Name>(name: WithValue<K, ValueName>): K extends keyof Value ? Value[K] : string | undefined;

  /** Whether an option was supplied. Defaults don't count. */
  has(name: Name): boolean;

  /** How many values an option has, or how many times a repeatable option without arguments was used. */
  count(name: Name): number;
}

/** Whether `T` is more than one type. */
type IsUnion<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

/**
 * The argument of `get` and `all` for the name `K`. A name of an option with
 * a value is itself. A name of a flag is a message that says so. Anything
 * else, like a misspelling, leaves `K` as every name there is, and the
 * argument is then any name with a value, which is what TypeScript lists in
 * its error and an editor suggests.
 *
 * The message is joined to `K` so that it's still a kind of string. The
 * typed options are then accepted wherever `OptionArgs` is asked for.
 */
type WithValue<K, ValueName> = [K] extends [ValueName]
  ? K
  : IsUnion<K> extends true
    ? ValueName
    : K & Invalid<`'${K & string}' takes no value. Use has() or count() to read it.`>;

/** The options a command's action can read: the command's own, and the persistent ones above it. */
type OptionsFor<O> = [O] extends [never]
  ? OptionReader<never, never, unknown, unknown>
  : OptionReader<
      Name<O>,
      ValueName<O>,
      { [K in Extract<Written<KeysOf<Valued<O>>>, string>]: Get<Named<O, K>> },
      { [K in Extract<Written<KeysOf<Valued<O>>>, string>]: All<Named<O, K>> }
    >;

/**
 * What an action receives: `ActionInit`, with the positional arguments as
 * `Args` and the options as `Options`.
 */
interface Init<Args, Options> extends Omit<ActionInit, "args" | "options"> {
  /** Positional arguments found for the selected command. */
  args: Args;

  /** Options found for this invocation. */
  options: Options;
}

/** What the action of command `Y` receives, below ancestors whose persistent options are `Inherited`. */
type InitFor<Y, Inherited> = Y extends unknown
  ? Init<ArgsOf<Y>, OptionsFor<OptionsOf<Y> | Inherited>>
  : never;

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

/** The action of a command whose action was written against `ActionInit`. */
type Loose = { action?: (init: ActionInit) => Result };

/**
 * The options an option's action can read: the ones in `O`, by name. Each
 * value is as loose as `OptionArgs` gives it, because an option's action
 * runs without the checks for required options.
 */
type OptionsIn<O> = [O] extends [never]
  ? OptionReader<never, never, unknown, unknown>
  : OptionReader<Name<O>, ValueName<O>, unknown, unknown>;

/**
 * The action of an option on a command that can read the options in `Scope`.
 * `Tree` gives an option that scope as what it inherits. An option's action runs in place of the command's, without the
 * checks for argument counts, so `args` is a list of any length. The option
 * names are the same either way, so they're still checked.
 */
type OfOption<Y, Scope> = {
  action?: (init: Init<string[], OptionsIn<Scope>>) => Result;
} & Refers<Y, Scope, "dependsOn"> &
  Refers<Y, Scope, "exclusiveOn">;

/**
 * Field `K` of option `Y`, which lists other options by name, as names of
 * options the command can use. An option typed `Option` lists plain strings,
 * and isn't checked.
 */
type Refers<Y, Scope, K extends "dependsOn" | "exclusiveOn"> = Y extends { [P in K]: readonly (infer N)[] }
  ? string extends N
    ? unknown
    : { [P in K]?: readonly Referred<Scope>[] }
  : unknown;

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
      ? OfOption<Y, Inherited>
      : unknown;

/**
 * What each field of `S` has to be. A field that `Tree` reads one by one is
 * left open, unless nothing of it could be inferred. Then the schema type
 * gives its callbacks their parameter types.
 *
 * Any other field has its schema type, but only where the value doesn't
 * already fit it. Requiring the schema type of a value that fits would add
 * nothing, and it stops TypeScript reading a list that starts with a spread,
 * like `suggestions: [...names, "all"]`, as the tuple it inferred for it.
 */
type Fields<Y, S> = {
  [K in keyof S]: K extends "action"
    ? unknown
    : K extends keyof Y
      ? [Child<S, K>] extends [never]
        ? Y[K] extends S[K]
          ? unknown
          : Y[K] extends Primitive
            ? Expected<NonNullable<S[K]>>
            : S[K]
        : unknown extends Y[K]
          ? S[K]
          : unknown
      : [Child<S, K>] extends [never]
        ? S[K]
        : unknown;
};

/**
 * What a plain value of the wrong type has to be, so that TypeScript names
 * the type it should have had. Requiring `T` itself of a value like `"yes"`
 * leaves it nothing it could be, and TypeScript then reports every other
 * field of the object too.
 */
interface Expected<T> {
  readonly [problem]: T;
}

declare const problem: unique symbol;

/**
 * What a value with something wrong with it has to be, so that it never
 * fits. TypeScript names this type in the error, and `Problem` is the
 * message. It's an object type and not `never`, because a field that can
 * only be `never` makes TypeScript report every other field of the object
 * too.
 */
interface Invalid<Problem extends string> {
  readonly [problem]: Problem;
}

/** What schema `S` describes, for a message. */
type Described<S> =
  IsCommand<S> extends true
    ? "a command"
    : IsOption<S> extends true
      ? "an option"
      : "isVariadic" extends keyof S
        ? "an argument"
        : "custom" extends keyof S
          ? "a generator"
          : "optionArgSeparators" extends keyof S
            ? "parserDirectives"
            : "this object";

/**
 * A key the schema doesn't have. In the body a `loadSpec` returns, a key like
 * `description` is a field of a command, but one its parent reads before the
 * body loads.
 */
type Unknown<Y, S> = {
  [K in Exclude<keyof Y, keyof S>]: IsCommand<S> extends true
    ? K extends keyof Subcommand
      ? Invalid<`'${K & string}' goes on the command that has the loadSpec, beside its name.`>
      : Invalid<`'${K & string}' isn't a field of a command. Check its spelling.`>
    : Invalid<`'${K & string}' isn't a field of ${Described<S>}. Check its spelling.`>;
};

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
        : Invalid<`'${K & string}' is empty. Leave it out instead.`>
      : Y[K] extends readonly [unknown]
        ? [Child<S, K>] extends NonNullable<S[K]>
          ? unknown
          : Invalid<`'${K & string}' is a list of one. Write the one value without the list.`>
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

/**
 * The options that the values under key `I` of `X` are given as inherited. A
 * command's subcommands inherit its persistent options. Its own `options` are
 * given every option the command can read, so that an option's action can
 * read them by name.
 */
type Passed<X, I, Inherited> = I extends "options"
  ? Inherited | OptionsOf<X>
  : Inherited | Persistent<OptionsOf<X>>;

/** `S` is the schema of `X`, or of the elements of `X` where it's a list. */
type Tree<X, Inherited, S> = {
  [I in keyof X]: Whole<X, X[I], S> &
    Tree<X[I], Passed<X, I, Inherited>, X extends readonly unknown[] ? S : Child<S, I>>;
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
