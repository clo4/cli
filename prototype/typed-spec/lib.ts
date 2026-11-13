import type { ActionInit, Spec, Subcommand } from "../../src/index.ts";
type AsTuple<T> = T extends readonly unknown[] ? T : T extends undefined ? [] : [T];
type One<A> = A extends { isVariadic: true }
  ? A extends { isOptional: true }
    ? string[]
    : [string, ...string[]]
  : A extends { isOptional: true }
    ? A extends { default: string }
      ? [string]
      : [string?]
    : [string];
type ArgsTuple<A> = AsTuple<A> extends readonly [infer H, ...infer R] ? [...One<H>, ...ArgsTuple<R>] : [];
type NameOf<O> = O extends { name: infer N } ? (N extends readonly string[] ? N[number] : N) : never;
type Literal<N> = string extends N ? never : N;
type Pick1<O, K> = O extends unknown ? (K extends NameOf<O> ? O : never) : never;
type Valued<O> = O extends { args: object } ? O : never;
type Persistent<O> = O extends { isPersistent: true } ? O : never;
type Get<O> = O extends { args: infer A }
  ? AsTuple<A> extends readonly [infer H, ...unknown[]]
    ? H extends { isOptional: true }
      ? string | undefined
      : H extends { default: string }
        ? string
        : O extends { isRequired: true }
          ? string
          : string | undefined
    : never
  : never;
export interface Options<O> {
  readonly options: Map<string, string[]>;
  has(name: Literal<NameOf<O>>): boolean;
  get<K extends Literal<NameOf<Valued<O>>>>(name: K): Get<Pick1<O, K>>;
  all(name: Literal<NameOf<Valued<O>>>): string[];
  count(name: Literal<NameOf<O>>): number;
}
export interface Init<A, O> extends Omit<ActionInit, "args" | "options"> {
  args: ArgsTuple<A>;
  options: Options<O>;
}
type El<T> = T extends readonly (infer E)[] ? E : never;
type OptsOf<T> = El<T extends { options: infer O } ? O : []>;
type ArgsOf<T> = T extends { args: infer A } ? A : undefined;
type Result = number | void | Promise<number | void>;

type Typed<Y, Inh> = { action?: (init: Init<ArgsOf<Y>, OptsOf<Y> | Inh>) => Result };
type Loose = { action?: (init: ActionInit) => Result };

// Each node is checked against the schema type for its place in the tree: S is Spec, Subcommand, Option, Arg and
// so on. A command is a schema with subcommands, and an option is any other schema with an action.
type IsCommand<S> = "subcommands" extends keyof S ? true : false;
type IsOption<S> = "action" extends keyof S ? true : false;
type Element<T> = T extends readonly (infer E)[] ? E : T;
type IsObject<E> = [E] extends [(...args: never[]) => unknown] ? false : [E] extends [object] ? true : false;
/** The schema of the values under key K, when they're objects the walk checks one by one. */
type Child<S, K> = K extends keyof S
  ? IsObject<Element<NonNullable<S[K]>>> extends true
    ? Element<NonNullable<S[K]>>
    : never
  : never;
/** S with each key the walk checks left open, so a list is never required to match two tuple types at once. */
type Shallow<S> = {
  [K in keyof S]: K extends "action" ? unknown : [Child<S, K>] extends [never] ? S[K] : unknown;
};
/** A key the schema doesn't have. */
type Unknown<Y, S> = { [K in Exclude<keyof Y, keyof S>]: never };

// A command's action gets the typed init, unless it's a function already written against the loose one.
type Act<Y, Inh, S> =
  IsCommand<S> extends true
    ? Y extends { action?: infer F }
      ? unknown extends F
        ? Typed<Y, Inh>
        : NonNullable<F> extends (init: ActionInit) => Result
          ? Loose
          : Typed<Y, Inh>
      : Typed<Y, Inh>
    : IsOption<S> extends true
      ? Loose
      : unknown;

/** What an object with schema S has to be, beyond what its keys are walked for. */
type Own<Y, Inh, S> = [S] extends [never] ? unknown : Act<Y, Inh, S> & Shallow<S> & Unknown<Y, S>;
type Primitive = string | number | boolean | bigint | symbol | null | undefined;
type IsArray<X> = X extends readonly unknown[] ? true : false;

// A value is inferred whole when it holds no unannotated function, and piece by piece when it does. No conditional
// type sits between the root and a nested command, because TypeScript infers nothing through one. S is the schema
// of X, or of X's elements when X is an array.
type Tree<X, Inh, S> = {
  [I in keyof X]: Whole<X, X[I], S> &
    Tree<X[I], Inh | Persistent<OptsOf<X>>, IsArray<X> extends true ? S : Child<S, I>>;
} & (X extends readonly unknown[] | Primitive ? unknown : Own<X, Inh, S>);
// Inference reads a value whole here. Once the spec is known, only a primitive is required to match, because the
// walk beside it already requires every object and array to. Requiring both made the check quadratic. So did
// reading each command in a list whole as well as each of its keys.
type Whole<X, V, S> = V extends object
  ? unknown
  : IsArray<X> extends true
    ? IsCommand<S> extends true
      ? unknown
      : V
    : V;

type Body = Omit<Subcommand, "name"> & { name?: Subcommand["name"] };
export declare function spec<const T>(s: Tree<T, never, Spec>): Spec;
export declare function command<const T>(s: Tree<T, never, Body>): Subcommand;
