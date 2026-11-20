import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import { InvalidValue, MissingRequiredOption, SeveralProblems, TooFewArguments } from "../src/errors.js";
import { parse } from "../src/parse.js";
import { captureConsole, run, runSpecCheck } from "./helpers.js";

/** Fails to compile unless `Actual` is exactly `Expected`. */
function is<Expected>() {
  return <Actual>(
    _value: Actual,
    ..._same: (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? [] : [never]
  ): void => {};
}

/** A Standard Schema that gives what `read` returns, and rejects the value with what it throws. */
function schema<Output>(
  read: (value: string) => Output | Promise<Output>,
): CLI.StandardSchemaV1<string, Output> {
  const settle = (thrown: unknown) => ({
    issues: [{ message: thrown instanceof Error ? thrown.message : String(thrown) }],
  });
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate(value) {
        try {
          const result = read(value as string);
          return result instanceof Promise ? result.then((value) => ({ value }), settle) : { value: result };
        } catch (thrown) {
          return settle(thrown);
        }
      },
    },
  };
}

const port = CLI.number({ min: 1, max: 65535, int: true });

/** A Standard Schema with two issues for a value it rejects. */
const toggle: CLI.StandardSchemaV1<string, boolean> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      value === "on" || value === "off"
        ? { value: value === "on" }
        : { issues: [{ message: "expected on or off" }, { message: "got something else" }] },
  },
};

/** A Standard Schema that takes a number, which no command line value is. */
const fromNumber: CLI.StandardSchemaV1<number, string> = {
  "~standard": { version: 1, vendor: "test", validate: (value) => ({ value: String(value) }) },
};

// Types {{{
// Everything in this section is checked by the compiler. The actions never run.

function use(value: number): number {
  return value;
}

CLI.spec({
  name: "types",
  // The action is above the arguments and options it reads.
  action({ args: [target, count, plain], options }) {
    is<URL>()(target);
    is<number>()(count);
    is<string>()(plain);
    is<number>()(options.get("--port"));
    is<Date | undefined>()(options.get("--when"));
    is<boolean | undefined>()(options.get("--schema"));
    is<string | undefined>()(options.get("--plain"));
    is<"debug" | "release">()(options.get("--mode"));
    is<bigint[]>()(options.all("--size"));
    is<[number, string]>()(options.all("--pair"));
    // @ts-expect-error An unknown name is still rejected.
    options.get("--nope");
  },
  args: [
    { name: "target", parse: schema((value) => new URL(value)) },
    { name: "count", parse: CLI.number({ int: true }) },
    { name: "plain" },
  ],
  options: [
    {
      name: "--port",
      description: "x",
      isPersistent: true,
      args: { name: "port", default: "80", parse: port },
    },
    { name: "--when", description: "x", args: { name: "date", parse: schema((value) => new Date(value)) } },
    { name: "--schema", description: "x", args: { name: "s", parse: toggle } },
    { name: "--plain", description: "x", args: { name: "p" } },
    {
      name: "--mode",
      description: "x",
      args: { name: "m", default: "debug", parse: CLI.choice("debug", "release") },
    },
    {
      name: "--size",
      description: "x",
      isRepeatable: true,
      args: { name: "s", parse: schema((value) => BigInt(value)) },
    },
    { name: "--pair", description: "x", isRequired: true, args: [{ name: "a", parse: port }, { name: "b" }] },
  ],
  subcommands: [
    {
      name: "async",
      options: [
        {
          name: "--url",
          description: "x",
          args: { name: "u", parse: schema(async (value) => new URL(value)) },
        },
      ],
      // An action that returns what it works out from its input.
      action: ({ options }) => use(options.get("--port")) + (options.get("--url")?.port.length ?? 0),
    },
    {
      name: "variadic",
      args: [{ name: "first" }, { name: "rest", isVariadic: true, parse: port }],
      action({ args: [first, ...rest] }) {
        is<string>()(first);
        is<[number, ...number[]]>()(rest);
      },
    },
    {
      name: "optional",
      args: { name: "n", isOptional: true, parse: port },
      action: ({ args }) => is<[] | [number]>()(args),
    },
    {
      name: "loose",
      args: { name: "n", parse: port },
      // An action written for any command.
      action: (init: CLI.ActionInit<unknown>) => (init.args.length > 0 ? 0 : 1),
    },
    {
      name: "strings",
      args: { name: "n", parse: port },
      // @ts-expect-error An action that reads strings doesn't fit a command whose parse gives a number.
      action: (init: CLI.ActionInit) => (init.args.length > 0 ? 0 : 1),
    },
    {
      name: "option-action",
      options: [
        { name: "--n", description: "x", args: { name: "n", parse: port } },
        {
          name: "--show",
          description: "x",
          // An option's action reads what was typed.
          action({ options }) {
            is<string | undefined>()(options.get("--n"));
          },
        },
      ],
    },
    // @ts-expect-error A schema has to take a string.
    { name: "bad-schema", args: { name: "n", parse: fromNumber } },
    // @ts-expect-error A parse is a schema, and a function isn't one.
    { name: "function", args: { name: "n", parse: (value: string) => Number(value) } },
  ],
});

// An option made by a function typed `Option` doesn't say what its parser
// gives, so its value is read as a string unless the action says otherwise.
function retries(): CLI.Option {
  return { name: "--retries", description: "x", args: { name: "n", parse: port } };
}
// One written `as const` keeps the type of its parser.
const level = { name: "--level", description: "x", args: { name: "n", parse: port } } as const;
CLI.command({
  name: "made",
  options: [retries(), { name: "--other", description: "x" }],
  action({ options }) {
    is<string | undefined>()(options.get("--retries"));
  },
});
CLI.command({
  name: "shared",
  options: [level, { name: "--other", description: "x" }],
  action({ options }) {
    is<number | undefined>()(options.get("--level"));
  },
});

// A spec typed `Spec` takes any parse. Its actions read strings, and say so
// where a parse gives something else.
({
  name: "untyped",
  args: { name: "count", parse: port },
  options: [{ name: "--port", args: { name: "port", parse: port } }],
  action({ options, args }) {
    is<string[]>()(args);
    is<string | undefined>()(options.get("--name"));
    is<number | undefined>()(options.get<number>("--port"));
    is<string[]>()(options.all("--name"));
    is<number[]>()(options.all<number>("--port"));
  },
}) satisfies CLI.Spec;

// A helper written for any options takes the typed ones.
function anyOptions(options: CLI.OptionArgs<unknown>): boolean {
  return options.has("--verbose");
}
CLI.spec({
  name: "helper",
  options: [{ name: "--port", description: "x", args: { name: "port", parse: port } }],
  action: ({ options }) => (anyOptions(options) ? 0 : 1),
});

// }}}

/** What the action of `spec` received for `argv`, with what `run` printed. */
async function received(spec: CLI.Spec, argv: readonly string[]) {
  let init: CLI.ActionInit<unknown> | undefined;
  const withAction = withActions(spec, (given) => void (init = given));
  const { code, stdout, stderr } = await captureConsole(() => run(withAction, argv));
  return { code, stdout, stderr, init };
}

/** A copy of `command` where every command's action is `action`. */
function withActions<C extends CLI.Subcommand>(
  command: C,
  action: (init: CLI.ActionInit<unknown>) => void,
): C {
  return {
    ...command,
    action: action as CLI.Action,
    subcommands: command.subcommands?.map((sub) => withActions(sub, action)),
  } as C;
}

const serve = CLI.spec({
  name: "serve",
  description: "Serve a folder",
  args: [
    { name: "port", description: "Port to listen on", parse: port },
    { name: "extra", isOptional: true, isVariadic: true, parse: schema((value) => value.toUpperCase()) },
  ],
  options: [
    CLI.help,
    { name: ["-t", "--toggle"], description: "Toggle", args: { name: "state", parse: toggle } },
    { name: "--token", description: "Token", isRequired: true, args: { name: "token" } },
    { name: "--retry", description: "Retry", isRepeatable: true, args: { name: "count", parse: port } },
    {
      name: "--inspect",
      description: "Inspect",
      args: { name: "port", isOptional: true, default: "9229", parse: port },
    },
    { name: "--listen", description: "Listen", args: { name: "port", default: "8080", parse: port } },
    {
      name: "--mode",
      description: "Build mode",
      args: { name: "mode", parse: CLI.choice("debug", "release") },
    },
  ],
});

test("a parse turns each value into what the action receives", async () => {
  const { code, init } = await received(serve, [
    "80",
    "a",
    "b",
    "--token",
    "abc",
    "-t",
    "on",
    "--retry",
    "1",
    "--retry=2",
    "--mode",
    "release",
  ]);
  expect(code).toBe(0);
  expect(init!.args).toEqual([80, "A", "B"]);
  expect(init!.options.get("--toggle")).toBe(true);
  // Every name of an option reads the same parsed values.
  expect(init!.options.get("-t")).toBe(true);
  expect(init!.options.all("--retry")).toEqual([1, 2]);
  expect(init!.options.count("--retry")).toBe(2);
  expect(init!.options.get("--mode")).toBe("release");
  // A value without a parse is the string that was typed.
  expect(init!.options.get("--token")).toBe("abc");
  expect(init!.options.options.get("--toggle")).toEqual([true]);
});

test("a default goes through its argument's parser", async () => {
  const { init } = await received(serve, ["80", "--token", "abc", "--inspect"]);
  // The default of an optional argument, for a bare option.
  expect(init!.options.get("--inspect")).toBe(9229);
  // The default of a required argument, for an option that wasn't used.
  expect(init!.options.has("--listen")).toBe(false);
  expect(init!.options.get("--listen")).toBe(8080);
  expect(init!.options.all("--listen")).toEqual([8080]);

  const positional = CLI.spec({
    name: "demo",
    args: { name: "port", isOptional: true, default: "443", parse: port },
  });
  expect((await received(positional, [])).init!.args).toEqual([443]);
});

test("a rejected value is a usage error that says what the schema said", async () => {
  await expect(parse(["http", "--token", "abc"], serve)).rejects.toThrow(InvalidValue);
  const { code, stderr, init } = await received(serve, ["http", "--token", "abc"]);
  expect(code).toBe(1);
  expect(init).toBeUndefined();
  expect(stderr).toContain('Error: Invalid value "http" for <port>: expected an integer from 1 to 65535\n');
  expect(stderr).toContain("Usage:");
});

test("a rejected value close to one the schema lists gets a suggestion", async () => {
  const typo = await received(serve, ["public", "--token", "abc", "--mode", "relese"]);
  expect(typo.code).toBe(1);
  expect(typo.stderr).toContain('Error: Invalid value "relese" for --mode: expected debug | release\n');
  expect(typo.stderr).toContain("Did you mean 'release'?");

  const far = await received(serve, ["public", "--token", "abc", "--mode", "fast"]);
  expect(far.stderr).not.toContain("Did you mean");

  // A number has no values to suggest.
  const port = await received(serve, ["public", "--token", "abc", "--port", "http"]);
  expect(port.stderr).not.toContain("Did you mean");
});

test("a rejected default gets no suggestion, because the user didn't type it", async () => {
  const spec = CLI.spec({
    name: "demo",
    args: { name: "mode", isOptional: true, default: "relese", parse: CLI.choice("debug", "release") },
    action() {},
  });
  const { code, stderr } = await received(spec, []);
  expect(code).toBe(1);
  expect(stderr).toContain('The default "relese" for <mode> is invalid');
  expect(stderr).not.toContain("Did you mean");
});

test("every problem with a readable command line is reported together", async () => {
  const argv = ["http", "-t", "maybe", "--retry", "0", "--retry", "3", "--mode", "fast"];
  let thrown: unknown;
  try {
    await parse(argv, serve);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(SeveralProblems);
  const problems = (thrown as SeveralProblems).problems;
  expect(problems.map((problem) => problem.constructor)).toEqual([
    MissingRequiredOption,
    InvalidValue,
    InvalidValue,
    InvalidValue,
    InvalidValue,
  ]);
  expect(problems.map((problem) => problem.message)).toEqual([
    "Option --token is required, but wasn't found",
    'Invalid value "http" for <port>: expected an integer from 1 to 65535',
    'Invalid value "maybe" for -t: expected on or off; got something else',
    'Invalid value "0" for --retry: expected an integer from 1 to 65535',
    'Invalid value "fast" for --mode: expected debug | release',
  ]);

  const { code, stderr } = await received(serve, argv);
  expect(code).toBe(1);
  // One line for each problem, then the help once.
  expect(stderr.match(/^Error: /gm)).toHaveLength(5);
  expect(stderr.match(/Usage:/g)).toHaveLength(1);

  // A missing argument is one more of them.
  try {
    await parse(["-t", "maybe"], serve);
    expect.unreachable();
  } catch (error) {
    expect((error as SeveralProblems).problems.map((problem) => problem.constructor)).toEqual([
      TooFewArguments,
      MissingRequiredOption,
      InvalidValue,
    ]);
  }
});

test("a token the parser can't read is still reported alone", async () => {
  let thrown: unknown;
  try {
    await parse(["http", "--nope", "-t", "maybe"], serve);
  } catch (error) {
    thrown = error;
  }
  expect((thrown as Error).message).toContain('"--nope" looks like a flag');
  expect(thrown).not.toBeInstanceOf(SeveralProblems);
});

test("an invalid default says it's the default", async () => {
  const spec = CLI.spec({
    name: "demo",
    options: [{ name: "--listen", description: "x", args: { name: "port", default: "http", parse: port } }],
  });
  await expect(parse([], spec)).rejects.toThrow(
    'The default "http" for --listen is invalid: expected an integer from 1 to 65535',
  );
});

test("an option action runs without any parse", async () => {
  // --help prints help however wrong the values are.
  const { code, stdout, stderr } = await captureConsole(() => run(serve, ["http", "-t", "maybe", "--help"]));
  expect(code).toBe(0);
  expect(stderr).toBe("");
  expect(stdout).toContain("Serve a folder");

  let seen: unknown;
  const spec = CLI.spec({
    name: "demo",
    options: [
      { name: "--port", description: "x", args: { name: "port", parse: port } },
      { name: "--show", description: "x", action: ({ options }) => void (seen = options.get("--port")) },
    ],
  });
  await run(spec, ["--port", "http", "--show"]);
  expect(seen).toBe("http");
});

test("a schema can be async, and then the parse waits for it", async () => {
  const order: string[] = [];
  const spec = CLI.spec({
    name: "demo",
    args: [
      {
        name: "slow",
        parse: schema(async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push("slow");
          return value.length;
        }),
      },
      {
        name: "fast",
        parse: schema(async (value) => {
          order.push("fast");
          return `${value}!`;
        }),
      },
      { name: "bad", isOptional: true, parse: schema(() => Promise.reject(new Error("never valid"))) },
    ],
  });
  expect((await parse(["abc", "x"], spec)).args).toEqual([3, "x!"]);
  // The schemas ran together.
  expect(order).toEqual(["fast", "slow"]);

  await expect(parse(["abc", "x", "y"], spec)).rejects.toThrow('Invalid value "y" for <bad>: never valid');
  const { code, stderr } = await captureConsole(() => run(spec, ["abc", "x", "y"]));
  expect(code).toBe(1);
  expect(stderr).toContain('Invalid value "y" for <bad>: never valid');
});

test("a schema that throws still says what's wrong with the value", async () => {
  const broken: CLI.StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => {
        throw new Error("the schema has a bug");
      },
    },
  };
  const spec = CLI.spec({ name: "demo", args: { parse: broken } });
  await expect(parse(["x"], spec)).rejects.toThrow('Invalid value "x" for <argument>: the schema has a bug');
});

test("each value is parsed once, and only for the command that runs", async () => {
  const calls: string[] = [];
  const note = schema((value) => {
    calls.push(value);
    return value;
  });
  const spec = CLI.spec({
    name: "demo",
    options: [
      {
        name: "--tag",
        description: "x",
        isPersistent: true,
        isRepeatable: true,
        args: { name: "t", parse: note },
      },
      { name: "--root", description: "x", args: { name: "r", default: "root-default", parse: note } },
    ],
    subcommands: [
      {
        name: "sub",
        args: { name: "words", isVariadic: true, parse: note },
        options: [
          { name: "--local", description: "x", args: { name: "l", default: "local-default", parse: note } },
        ],
      },
    ],
  });
  const { init } = await received(spec, ["--tag", "a", "sub", "x", "--tag=b", "y"]);
  // The root's own option isn't in the subcommand's reach, so its default isn't parsed.
  expect([...calls].sort()).toEqual(["a", "b", "local-default", "x", "y"]);
  expect(init!.options.all("--tag")).toEqual(["a", "b"]);
  expect(init!.args).toEqual(["x", "y"]);
});

test("an option read by its ref has its parsed value", async () => {
  const spec = CLI.spec({
    name: "demo",
    options: [
      {
        name: "--level",
        ref: "root-level",
        description: "x",
        isPersistent: true,
        args: { name: "n", parse: port },
      },
    ],
    subcommands: [
      {
        name: "sub",
        options: [
          {
            name: "--level",
            ref: "sub-level",
            description: "x",
            args: { name: "n", parse: schema((value) => `sub ${value}`) },
          },
        ],
      },
    ],
  });
  const { init } = await received(spec, ["--level", "1", "sub", "--level", "2"]);
  expect(init!.options.get("root-level")).toBe(1);
  expect(init!.options.get("sub-level")).toBe("sub 2");
  expect(init!.options.get("--level")).toBe("sub 2");
});

test("spec check: every number range has a number in it", async () => {
  const withRange = (parse: CLI.StandardSchemaV1<string, number>) =>
    CLI.spec({ name: "demo", options: [{ name: "--n", description: "x", args: { name: "n", parse } }] });
  await runSpecCheck("assertRangesAreNotEmpty", serve);
  await runSpecCheck("assertRangesAreNotEmpty", withRange(CLI.number({ min: 1, max: 1 })));
  await runSpecCheck("assertRangesAreNotEmpty", withRange(CLI.number({ min: 0.2, max: 0.8 })));
  await expect(
    runSpecCheck("assertRangesAreNotEmpty", withRange(CLI.number({ min: 10, max: 1 }))),
  ).rejects.toThrow(
    "Option `demo --n` (index 0), argument n has a parser that rejects every value, since it asks for a number from 10 to 1",
  );
  // A range of integers with no whole number in it.
  await expect(
    runSpecCheck("assertRangesAreNotEmpty", withRange(CLI.number({ min: 0.2, max: 0.8, int: true }))),
  ).rejects.toThrow("since it asks for an integer from 0.2 to 0.8");
});

/** What `schema` gives for `value`, or the message it rejects it with. */
function read(schema: CLI.StandardSchemaV1<string, unknown>, value: string): unknown {
  const result = schema["~standard"].validate(value) as CLI.StandardResult<unknown>;
  return result.issues ? result.issues[0].message : result.value;
}

test("number: reads decimal digits and nothing else", async () => {
  const any = CLI.number();
  expect(read(any, "42")).toBe(42);
  expect(read(any, "-1.5")).toBe(-1.5);
  expect(read(any, ".5")).toBe(0.5);
  expect(read(any, "007")).toBe(7);
  for (const value of [
    "",
    " 42 ",
    "0x1F",
    "1e3",
    "+7",
    "abc",
    "Infinity",
    "1,000",
    "--1",
    ".",
    "3.",
    "-3.",
    "-.",
  ]) {
    expect(read(any, value), value).toBe("expected a number");
  }
});

test("number: rejects digits that read as infinity", async () => {
  const huge = "9".repeat(400);
  expect(Number(huge)).toBe(Infinity);
  expect(read(CLI.number(), huge)).toBe("too large to be a number");
  expect(read(CLI.number(), `-${huge}`)).toBe("too small to be a number");
  expect(read(CLI.number({ min: 0 }), huge)).toBe("too large to be a number");
  expect(read(CLI.number({ max: 0 }), `-${huge}`)).toBe("too small to be a number");
  // A range the value is outside says the range.
  expect(read(CLI.number({ max: 10 }), huge)).toBe("expected a number, at most 10");
  expect(read(CLI.number({ min: 0 }), `-${huge}`)).toBe("expected a number, at least 0");
  expect(read(CLI.number(), "1" + "0".repeat(308))).toBe(1e308);
});

test("number: int accepts whole numbers only", async () => {
  const whole = CLI.number({ int: true });
  expect(read(whole, "-12")).toBe(-12);
  expect(read(whole, "1.0")).toBe("expected an integer");
  expect(read(whole, "1.5")).toBe("expected an integer");
  // Too large to be the number that was typed.
  expect(read(whole, "9007199254740993")).toBe("too large, the limit is 9007199254740991");
  expect(read(whole, "-9007199254740993")).toBe("too small, the limit is -9007199254740991");
  expect(read(whole, "9007199254740991")).toBe(9007199254740991);
  expect(read(port, "9007199254740993")).toBe("expected an integer from 1 to 65535");
});

test("number: min and max are included, and the message says the range", async () => {
  expect(read(port, "1")).toBe(1);
  expect(read(port, "65535")).toBe(65535);
  expect(read(port, "0")).toBe("expected an integer from 1 to 65535");
  expect(read(port, "65536")).toBe("expected an integer from 1 to 65535");
  expect(read(CLI.number({ min: 0 }), "-0.1")).toBe("expected a number, at least 0");
  expect(read(CLI.number({ max: 10, int: true }), "11")).toBe("expected an integer, at most 10");
  expect(read(CLI.number({ min: 0, max: 1 }), "0.5")).toBe(0.5);
});

test("choice: accepts one of its values, as written", async () => {
  const mode = CLI.choice("debug", "release", "very loud", "a|b", "");
  expect(read(mode, "release")).toBe("release");
  expect(read(mode, "very loud")).toBe("very loud");
  expect(read(mode, "")).toBe("");
  // A value that needs it is in quotes, so the list reads one way.
  expect(read(mode, "Debug")).toBe('expected debug | release | "very loud" | "a|b" | ""');
});

const described = CLI.spec({
  name: "demo",
  description: "Show what values can be",
  args: [
    { name: "count", description: "How many to make", parse: CLI.number({ min: 1, max: 10, int: true }) },
    { name: "scale", isOptional: true, default: "1", parse: CLI.number({ min: 0 }) },
    { name: "kind", isOptional: true, parse: CLI.choice("a", "b", "c") },
  ],
  options: [
    {
      name: "--port",
      description: "Listen on this port",
      args: { name: "port", default: "8080", parse: port },
    },
    {
      name: "--mode",
      description: "Build mode",
      args: { name: "mode", parse: CLI.choice("debug", "release") },
    },
    {
      name: "--level",
      description: "Log level",
      args: { name: "name", parse: CLI.choice("quiet", "very loud") },
    },
    { name: "--ratio", args: { name: "n", parse: CLI.number() } },
    {
      name: "--toggle",
      description: "A schema that doesn't describe itself",
      args: { name: "s", parse: toggle },
    },
    {
      name: "--size",
      description: "Two values, so neither is described",
      args: [
        { name: "w", parse: port },
        { name: "h", parse: port },
      ],
    },
  ],
});

/** A schema that describes itself as `described`, and accepts anything. */
function describedAs(described: Record<string, unknown>): CLI.StandardSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value: String(value) }),
      jsonSchema: { input: () => described },
    },
  };
}

test("help carries a long list of values on to the next line", async () => {
  const regions = [
    "us-east-1",
    "us-east-2",
    "us-west-1",
    "us-west-2",
    "eu-west-1",
    "eu-west-2",
    "eu-central-1",
    "ap-south-1",
    "ap-southeast-1",
  ] as const;
  const spec = CLI.spec({
    name: "deploy",
    options: [
      CLI.help,
      {
        name: "--region",
        description: "Where to deploy",
        args: { name: "region", default: "us-east-1", parse: CLI.choice(...regions) },
      },
    ],
  });
  const { stdout } = await captureConsole(() => run(spec, ["-h"]));
  expect(stdout).toContain(
    [
      "  --region <region>  Where to deploy",
      "                     (us-east-1 | us-east-2 | us-west-1 | us-west-2 | eu-west-1 |",
      "                     eu-west-2 | eu-central-1 | ap-south-1 | ap-southeast-1,",
      "                     default: us-east-1)",
      "",
    ].join("\n"),
  );
  // No line of it is wider than the descriptions the spec checks allow.
  for (const line of stdout.split("\n").filter((line) => line.startsWith("                     "))) {
    expect(line.trimStart().length).toBeLessThanOrEqual(68);
  }
});

test("help says which bounds a range leaves out", async () => {
  const spec = CLI.spec({
    name: "demo",
    options: [
      CLI.help,
      {
        name: "--a",
        description: "A",
        args: { name: "n", parse: describedAs({ type: "number", exclusiveMinimum: 0 }) },
      },
      {
        name: "--b",
        description: "B",
        args: { name: "n", parse: describedAs({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 }) },
      },
      {
        name: "--c",
        description: "C",
        args: { name: "n", parse: describedAs({ type: "integer", minimum: 0, exclusiveMaximum: 10 }) },
      },
      {
        name: "--d",
        description: "D",
        args: { name: "n", parse: describedAs({ type: "integer", maximum: 5 }) },
      },
    ],
  });
  const { stdout } = await captureConsole(() => run(spec, ["-h"]));
  expect(stdout).toContain("--a <n>     A (number, more than 0)\n");
  expect(stdout).toContain("--b <n>     B (number, more than 0 and less than 1)\n");
  expect(stdout).toContain("--c <n>     C (int, at least 0 and less than 10)\n");
  expect(stdout).toContain("--d <n>     D (int, at most 5)\n");
});

test("a rejected value of an option with several arguments says which argument", async () => {
  const spec = CLI.spec({
    name: "demo",
    options: [
      {
        name: "--size",
        description: "x",
        args: [{ name: "w", parse: port }, { parse: port }],
      },
    ],
  });
  await expect(parse(["--size", "3", "x"], spec)).rejects.toThrow(
    'Invalid value "x" for --size <argument 2>: expected an integer from 1 to 65535',
  );
  await expect(parse(["--size", "x", "3"], spec)).rejects.toThrow(
    'Invalid value "x" for --size <w>: expected an integer from 1 to 65535',
  );
});

test("help shows what a value can be, before its default", async () => {
  const { stdout } = await captureConsole(() =>
    run({ ...described, options: [CLI.help, ...described.options!] }, ["-h"]),
  );
  expect(stdout).toContain("  count  How many to make (int from 1 to 10)\n");
  expect(stdout).toContain("  scale  (number, at least 0, default: 1)\n");
  expect(stdout).toContain("  kind   (a | b | c)\n");
  expect(stdout).toContain("--port <port>   Listen on this port (int from 1 to 65535, default: 8080)\n");
  expect(stdout).toContain("--mode <mode>   Build mode (debug | release)\n");
  expect(stdout).toContain('--level <name>  Log level (quiet | "very loud")\n');
  expect(stdout).toContain("--ratio <n>     (number)\n");
  expect(stdout).toContain("--toggle <s>    A schema that doesn't describe itself\n");
  expect(stdout).toContain("--size <w> <h>  Two values, so neither is described\n");
});

/** What completion offers for the word after `before`. */
async function completions(spec: CLI.Spec, before: readonly string[]): Promise<string[]> {
  const withCompletion: CLI.Spec = { ...spec, subcommands: [CLI.completion] };
  const { stdout } = await captureConsole(() =>
    run(withCompletion, ["completion", "complete", "--shell", "fish", "--", ...before, ""]),
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[0]);
}

test("completion offers the values a schema lists, and never runs a parse", async () => {
  let calls = 0;
  const counting: CLI.StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        calls++;
        return { value: String(value) };
      },
    },
  };
  const spec = CLI.spec({
    name: "demo",
    options: [
      { name: "--mode", description: "x", args: { name: "mode", parse: CLI.choice("debug", "release") } },
      {
        name: "--level",
        description: "x",
        // The argument's own suggestions win.
        args: { name: "level", suggestions: ["low"], parse: CLI.choice("low", "high") },
      },
      { name: "--word", description: "x", args: { name: "word", parse: counting } },
    ],
  });
  expect(await completions(spec, ["--mode"])).toEqual(["debug", "release"]);
  expect(await completions(spec, ["--level"])).toEqual(["low"]);
  expect(await completions(spec, ["--word", "x", "--mode"])).toEqual(["debug", "release"]);
  expect(calls).toBe(0);
});

test("spec check: every default passes its argument's parser", async () => {
  await runSpecCheck("assertDefaultsPassTheirParse", serve);
  await expect(
    runSpecCheck(
      "assertDefaultsPassTheirParse",
      CLI.spec({
        name: "demo",
        options: [
          { name: "--listen", description: "x", args: { name: "port", default: "http", parse: port } },
        ],
      }),
    ),
  ).rejects.toThrow(
    'Option `demo --listen` (index 0), argument port has the default "http", which its parser rejects: expected an integer from 1 to 65535',
  );
  await expect(
    runSpecCheck(
      "assertDefaultsPassTheirParse",
      CLI.spec({
        name: "demo",
        args: {
          name: "word",
          isOptional: true,
          default: "no",
          parse: schema(async (value) => {
            if (value !== "yes") {
              throw new Error("say yes");
            }
            return value;
          }),
        },
      }),
    ),
  ).rejects.toThrow('In `demo`, argument word has the default "no", which its parser rejects: say yes');
});
