import { expect, test } from "vitest";

import CLI, { choice, int, many, number, optional, sepBy, seq, text, uint } from "../src/index.js";
import type { Parser, Spec } from "../src/index.js";
import { completionsOf, patternOf } from "../src/schemas.js";
import { captureConsole, run } from "./helpers.js";

/** Fails to compile unless `Actual` is exactly `Expected`. */
function is<Expected>() {
  return <Actual>(
    _value: Actual,
    ..._same: (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? [] : [never]
  ): void => {};
}

/** What `parser` gives for `value`, or the message it rejects it with. */
function read<T>(parser: Parser<T>, value: string): T | string {
  const result = parser.validate(value);
  return result.issues ? result.issues[0].message : result.value;
}

const duration = seq(int, choice("s", "m", "h", "d")).map(([amount, unit]) => ({ amount, unit }));
const size = seq(int.as("width"), "x", int.as("height")).map(([width, height]) => ({ width, height }));
const version = seq(optional("v"), int, ".", int, ".", int).map(([, major, minor, patch]) => ({
  major,
  minor,
  patch,
}));
const jobs = choice("auto", number({ int: true, min: 1, max: 64 }));
const scopes = sepBy(choice("read", "write", "admin"), ",");
const mode = many(choice("r", "w", "x"), 1);
const env = sepBy(
  seq(text("=", ","), "=", text(",")).map(([key, value]) => ({ key, value })),
  ",",
);

test("each parser gives the type its parts say", () => {
  is<Parser<{ amount: number; unit: "s" | "m" | "h" | "d" }>>()(duration);
  is<Parser<{ width: number; height: number }>>()(size);
  is<Parser<{ major: number; minor: number; patch: number }>>()(version);
  is<Parser<number | "auto">>()(jobs);
  is<Parser<("read" | "write" | "admin")[]>>()(scopes);
  is<Parser<("r" | "w" | "x")[]>>()(mode);
  is<Parser<{ key: string; value: string }[]>>()(env);
  // A seq is a Seq, so map it to compare what it gives as a plain Parser.
  is<Parser<[number, "v" | undefined, string]>>()(
    seq(int, "-", optional("v"), text()).map((values) => values),
  );
});

test("seq: reads its parts in order, and a string gives no value", () => {
  expect(read(duration, "10s")).toEqual({ amount: 10, unit: "s" });
  expect(read(size, "1920x1080")).toEqual({ width: 1920, height: 1080 });
  expect(read(seq("v", int, ".", int), "v6.1")).toEqual([6, 1]);
  expect(read(seq(), "")).toEqual([]);
});

test("a rejected value says what was expected, and after what", () => {
  expect(read(duration, "10x")).toBe('expected s | m | h | d after "10"');
  expect(read(duration, "ten")).toBe("expected an integer");
  expect(read(duration, "10")).toBe('expected s | m | h | d after "10"');
  expect(read(size, "1920*1080")).toBe('expected "x" after "1920"');
  expect(read(version, "6.1")).toBe('expected "." after "6.1"');
  expect(read(version, "x")).toBe('expected "v" or an integer');
  expect(read(env, "A=1,B")).toBe('expected "=" after "A=1,B"');
  expect(read(env, "=1")).toBe("expected some text");
});

test("a value with more after what the parser reads says what's extra", () => {
  expect(read(duration, "10sec")).toBe('unexpected "ec" after "10s"');
  expect(read(size, "1x2x3")).toBe('unexpected "x3" after "1x2"');
  // A parser that could have read more there says what instead.
  expect(read(scopes, "read;write")).toBe('expected "," after "read"');
  expect(read(mode, "rwz")).toBe('expected r | w | x after "rw"');
});

test("choice: takes parsers as well as strings, and the one that reads the most wins", () => {
  expect(read(jobs, "auto")).toBe("auto");
  expect(read(jobs, "8")).toBe(8);
  expect(read(jobs, "99")).toBe("expected an integer from 1 to 64 or auto");
  expect(read(choice("m", "ms"), "ms")).toBe("ms");
  expect(read(choice("ms", "m"), "m")).toBe("m");
  expect(read(seq(int, choice("m", "ms", "s")), "5ms")).toEqual([5, "ms"]);
  expect(read(choice(seq(int, "px"), int), "12px")).toEqual([12]);
  expect(read(choice(seq(int, "px"), int), "12")).toBe(12);
});

test("optional: gives its part's value, or undefined", () => {
  expect(read(version, "v6.1.2")).toEqual({ major: 6, minor: 1, patch: 2 });
  expect(read(version, "6.1.2")).toEqual({ major: 6, minor: 1, patch: 2 });
  expect(read(seq(int, optional(choice("k", "M"))), "5")).toEqual([5, undefined]);
  expect(read(seq(int, optional(choice("k", "M"))), "5M")).toEqual([5, "M"]);
  expect(read(optional("v"), "")).toBe(undefined);
});

test("many: reads its part again and again, and at least `min` times", () => {
  expect(read(mode, "rwx")).toEqual(["r", "w", "x"]);
  expect(read(mode, "")).toBe("expected r | w | x");
  expect(read(many(choice("r", "w", "x")), "")).toEqual([]);
  expect(read(many(seq(int, ";")), "1;2;")).toEqual([[1], [2]]);
  // A part that reads nothing ends the loop.
  expect(read(many(optional("a")), "aa")).toEqual(["a", "a"]);
  expect(read(many(optional("a"), 1), "")).toBe('expected "a"');
});

test("sepBy: reads one or more, and a separator means another one follows", () => {
  expect(read(scopes, "read")).toEqual(["read"]);
  expect(read(scopes, "read,write")).toEqual(["read", "write"]);
  expect(read(scopes, "read,delete")).toBe('expected read | write | admin after "read,"');
  expect(read(scopes, "read,")).toBe('expected read | write | admin after "read,"');
  expect(read(scopes, "")).toBe("expected read | write | admin");
  expect(read(sepBy(int, ", "), "1, 2, 3")).toEqual([1, 2, 3]);
});

test("text: reads up to the first stop, and needs a character", () => {
  expect(read(env, "A=1,B=two")).toEqual([
    { key: "A", value: "1" },
    { key: "B", value: "two" },
  ]);
  expect(read(seq(text("="), "=", text()), "KEY=a=b")).toEqual(["KEY", "a=b"]);
  expect(read(text(), "")).toBe("expected some text");
});

test("number: reads as much as is a number when more follows", () => {
  expect(read(seq(number(), "%"), "12.5%")).toEqual([12.5]);
  expect(read(seq(number(), "x", number()), "-.5x3.5")).toEqual([-0.5, 3.5]);
  // A dot with no digit after it is left for the next part.
  expect(read(seq(number(), "..", number()), "1..5")).toEqual([1, 5]);
  expect(read(seq(number(), "..", number()), "1.5..2.5")).toEqual([1.5, 2.5]);
  expect(read(seq(number(), "x", number()), "1x3.")).toBe('unexpected "." after "1x3"');
  expect(read(seq(int, ".", int), "1.5")).toEqual([1, 5]);
  expect(read(seq(number({ min: 1, max: 5 }), "x"), "9x")).toBe("expected a number from 1 to 5");
  expect(read(seq("n", number({ int: true, min: 1 })), "n0")).toBe(
    'expected an integer, at least 1 after "n"',
  );
});

test("uint: reads digits alone, and never a minus sign", () => {
  expect(read(uint, "12")).toBe(12);
  expect(read(uint, "007")).toBe(7);
  expect(read(uint, "-12")).toBe("expected an integer, at least 0");
  expect(read(uint, "-0")).toBe("expected an integer, at least 0");
  expect(read(uint, "12.5")).toBe("expected an integer, at least 0");
  expect(read(uint, "")).toBe("expected an integer, at least 0");
  expect(read(uint, "9007199254740991")).toBe(9007199254740991);
  // Too large to be the number that was typed.
  expect(read(uint, "9007199254740993")).toBe("too large, the limit is 9007199254740991");
  // Inside a format, the message says which number.
  expect(read(seq("v", uint, ".", uint), "v9007199254740993.1")).toBe(
    "9007199254740993 is too large, the limit is 9007199254740991",
  );
  expect(read(seq(uint, ".", uint), "1.-0")).toBe('expected an integer, at least 0 after "1."');
  expect(read(seq(int, ".", int), "-1.-6")).toEqual([-1, -6]);
  expect(read(seq(uint, ".", uint), "-1.-6")).toBe("expected an integer, at least 0");
  expect(read(seq(uint, "x", uint), "1920x-1080")).toBe('expected an integer, at least 0 after "1920x"');
  expect(read(seq(uint, "-", uint), "1-5")).toEqual([1, 5]);
  expect(read(seq(uint, "-", uint), "1--5")).toBe('expected an integer, at least 0 after "1-"');
});

test("map: gives what its function makes of the value, and only runs on a value that was read", () => {
  let calls = 0;
  const counted = int.map((value) => {
    calls++;
    return value * 2;
  });
  expect(read(counted, "21")).toBe(42);
  expect(read(counted, "x")).toBe("expected an integer");
  expect(calls).toBe(1);
});

test("a parser that isn't given a string rejects it", () => {
  expect(read(duration, 5 as unknown as string)).toBe("expected a string");
});

test("a map function can read another value with a parser of its own", () => {
  const inner = seq(int, "-", int);
  const outer = seq(
    int,
    choice("a", "b").map((value) => (inner.validate("12345?"), value)),
    choice("s", "m"),
  );
  expect(read(outer, "7b")).toBe('expected s | m after "7b"');
  expect(read(outer, "7bs")).toEqual([7, "b", "s"]);
});

test("a pattern shows each part, and a label in place of the part it names", () => {
  expect(patternOf(duration)).toBe("<int>(s|m|h|d)");
  expect(patternOf(size)).toBe("<width>x<height>");
  expect(patternOf(version)).toBe("[v]<int>.<int>.<int>");
  expect(patternOf(jobs)).toBe("(auto|<int>)");
  expect(patternOf(scopes)).toBe("(read|write|admin),...");
  expect(patternOf(mode)).toBe("(r|w|x)...");
  expect(patternOf(env)).toBe("<text>=<text>,...");
  expect(patternOf(number())).toBe("<number>");
  expect(patternOf(duration.as("duration"))).toBe("<duration>");
  // A label is only for help. The parser reads and gives the same.
  expect(read(size, "3x4")).toEqual({ width: 3, height: 4 });
  expect(read(int.as("width"), "x")).toBe("expected an integer");
});

test("asObject: gives each labelled value under its label, and drops the rest", () => {
  const size = seq(uint.as("width"), "x", uint.as("height")).asObject();
  is<Parser<{ width: number; height: number }>>()(size);
  expect(read(size, "1920x1080")).toEqual({ width: 1920, height: 1080 });
  expect(read(size, "1920x")).toBe('expected an integer, at least 0 after "1920x"');
  expect(patternOf(size)).toBe("<width>x<height>");

  // A part without a label gives no key.
  const major = seq(optional("v"), uint.as("major"), ".", uint).asObject();
  is<Parser<{ major: number }>>()(major);
  expect(read(major, "v2.1")).toEqual({ major: 2 });
  is<Parser<{}>>()(seq(uint, "x", uint).asObject());
  expect(read(seq(uint, "x", uint).asObject(), "1x2")).toEqual({});

  // A label stays on a parser through map, whichever is called first.
  const span = seq(
    uint.as("start").map(String),
    "-",
    choice("a", "b")
      .map((letter) => letter === "a")
      .as("end"),
  ).asObject();
  is<Parser<{ start: string; end: boolean }>>()(span);
  expect(read(span, "1-b")).toEqual({ start: "1", end: false });

  // A seq inside a seq gives its own object.
  const nested = seq(size.as("size"), "@", uint.as("scale")).asObject();
  is<Parser<{ size: { width: number; height: number }; scale: number }>>()(nested);
  expect(read(nested, "3x4@2")).toEqual({ size: { width: 3, height: 4 }, scale: 2 });
});

test("asObject: gives a value labelled __proto__ as a key of its own", () => {
  const fields = read(seq(seq(uint.as("x")).asObject().as("__proto__"), ",", uint.as("y")).asObject(), "1,2");
  expect(Object.keys(fields)).toEqual(["__proto__", "y"]);
  expect(Object.getPrototypeOf(fields)).toBe(Object.prototype);
});

test("asObject: rejects two parts with the same label", () => {
  const twice = seq(uint.as("width"), "x", uint.as("width"));
  // @ts-expect-error Two parts are labelled "width".
  expect(() => twice.asObject()).toThrow('Two parts of the seq are labelled "width"');
});

test("completionsOf: offers the strings that can come next, and a whole value that ends with one", () => {
  expect(completionsOf(duration, "10")).toEqual(["10s", "10m", "10h", "10d"]);
  expect(completionsOf(duration, "10s")).toEqual(["10s"]);
  expect(completionsOf(duration, "10q")).toEqual([]);
  expect(completionsOf(duration, "")).toEqual([]);
  expect(completionsOf(size, "1920")).toEqual(["1920x"]);
  expect(completionsOf(version, "")).toEqual(["v"]);
  expect(completionsOf(version, "6")).toEqual(["6."]);
  expect(completionsOf(jobs, "")).toEqual(["auto"]);
  expect(completionsOf(jobs, "a")).toEqual(["auto"]);
  expect(completionsOf(jobs, "8")).toEqual([]);
  expect(completionsOf(scopes, "read,w")).toEqual(["read,write"]);
  expect(completionsOf(scopes, "read")).toEqual(["read", "read,"]);
  expect(completionsOf(scopes, "read,")).toEqual(["read,read", "read,write", "read,admin"]);
  expect(completionsOf(choice("s", "sec"), "s")).toEqual(["s", "sec"]);
  // A map function that throws for a value that's only partly typed.
  const strict = seq(int, choice("s", "m")).map(() => {
    throw new Error("no");
  });
  expect(completionsOf(strict, "5")).toEqual(["5s", "5m"]);
});

test("completionsOf: offers a longer string of a choice after a shorter one was read", () => {
  const unit = seq(uint, choice("s", "sec", "seconds"));
  expect(completionsOf(unit, "5")).toEqual(["5s", "5sec", "5seconds"]);
  expect(completionsOf(unit, "5se")).toEqual(["5sec", "5seconds"]);
  expect(completionsOf(unit, "5seco")).toEqual(["5seconds"]);
  expect(completionsOf(choice("auto", "automatic"), "autom")).toEqual(["automatic"]);
  expect(completionsOf(many(choice("a", "ab")), "ab")).toEqual(["ab", "aba", "abab"]);
  // The first reads `a` and then wants `d`, and the second is still open.
  expect(completionsOf(seq(choice("a", seq("a", "b", "c")), "d"), "ab")).toEqual(["abc"]);
});

test("completionsOf: offers the other values of a choice that has an empty string", () => {
  const level = choice("", "low", "high");
  expect(completionsOf(level, "")).toEqual(["low", "high"]);
  expect(completionsOf(level, "l")).toEqual(["low"]);
  expect(completionsOf(seq(uint, level), "5")).toEqual(["5low", "5high"]);
  expect(read(level, "")).toBe("");
  expect(read(level, "x")).toBe('expected "" | low | high');
});

test("patternOf: keeps the brackets of an optional part that has a label", () => {
  const range = seq(optional(int).as("from"), "..", optional(int).as("to")).asObject();
  expect(patternOf(range)).toBe("[<from>]..[<to>]");
  // Through map, whichever is called first.
  expect(patternOf(optional(int).as("n").map(String))).toBe("[<n>]");
  expect(patternOf(optional(int).map(String).as("n"))).toBe("[<n>]");
  expect(patternOf(many(int).as("n"))).toBe("<n>");
});

test("patternOf: quotes a string that could be read as part of the pattern", () => {
  expect(patternOf(seq("[", uint, "]"))).toBe('"["<int>"]"');
  expect(patternOf(seq("<", text(">"), ">"))).toBe('"<"<text>">"');
  expect(patternOf(seq(uint, "...", uint))).toBe('<int>"..."<int>');
  expect(patternOf(seq(uint, choice("a|b", "(c)", "d")))).toBe('<int>("a|b"|"(c)"|d)');
  expect(patternOf(sepBy(uint, "|"))).toBe('<int>"|"...');
  expect(patternOf(seq(uint, "\t", uint, ""))).toBe('<int>"\\t"<int>""');
  // A space, a dot and a comma can only be themselves.
  expect(patternOf(seq(uint, " ", uint, "..", uint, ",", uint))).toBe("<int> <int>..<int>,<int>");
});

test("patternOf: puts a repeated part in brackets when its dots could be misread", () => {
  expect(patternOf(many(seq(uint, choice("h", "m", "s")), 1))).toBe("(<int>(h|m|s))...");
  expect(patternOf(many(many(choice("a"))))).toBe("((a)...)...");
  expect(patternOf(sepBy(sepBy(many(choice("a", "b")), ","), ";"))).toBe("(((a|b)...),...);...");
  expect(patternOf(many("ab"))).toBe("(ab)...");
  // Through map, and a label is one part.
  expect(patternOf(many(seq(uint, "x").map(([n]) => n)))).toBe("(<int>x)...");
  expect(patternOf(many(seq(uint, "x").as("n")))).toBe("<n>...");
  // One part needs none, and the separator of a sepBy says what repeats.
  expect(patternOf(many(choice("r", "w")))).toBe("(r|w)...");
  expect(patternOf(many("a"))).toBe("a...");
  expect(patternOf(sepBy(seq(text("="), "=", text(",")), ","))).toBe("<text>=<text>,...");
});

test("help carries a pattern too long for one line on to the next", async () => {
  const units = Array.from({ length: 30 }, (_, i) => `unit${i}`) as [string, ...string[]];
  const parts = Array.from({ length: 12 }, (_, i) => [uint.as(`part${i}`), "-"] as const).flat();
  const spec: Spec = {
    name: "long",
    options: [
      CLI.help,
      {
        name: "--amount",
        description: "How much",
        args: { name: "amount", parse: seq(uint, choice(...units)) },
      },
      { name: "--parts", description: "Each part", args: { name: "parts", parse: seq(...parts) } },
      { name: "--empty", description: "No parts", args: { name: "empty", parse: seq() } },
    ],
  };
  const { stdout } = await captureConsole(() => run(spec, ["--help"]));
  const details = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[(<u-]/.test(line) && !line.includes("--help"));
  expect(details).toEqual([
    "--amount <amount>  How much",
    "(<int>(unit0|unit1|unit2|unit3|unit4|unit5|unit6|unit7|unit8|",
    "unit9|unit10|unit11|unit12|unit13|unit14|unit15|unit16|unit17|",
    "unit18|unit19|unit20|unit21|unit22|unit23|unit24|unit25|unit26|",
    "unit27|unit28|unit29))",
    "--parts <parts>    Each part",
    "(<part0>-<part1>-<part2>-<part3>-<part4>-<part5>-<part6>-<part7>",
    "-<part8>-<part9>-<part10>-<part11>-)",
    "--empty <empty>    No parts",
  ]);
  for (const line of stdout.split("\n")) {
    expect(line.length).toBeLessThanOrEqual(100);
  }
});

const watch = CLI.spec({
  name: "watch",
  description: "Run a command again and again",
  args: { name: "size", isOptional: true, description: "Size of the window", parse: size },
  options: [
    CLI.help,
    { name: "--every", description: "Time between runs", args: { name: "duration", parse: duration } },
    { name: "--jobs", description: "How many to run at once", args: { name: "n", parse: jobs } },
    { name: "--scope", description: "What it may do", args: { name: "scopes", parse: scopes } },
    {
      name: "--color",
      description: "Colour the output",
      args: { name: "when", parse: choice("auto", "always", "never") },
    },
    { name: "--port", description: "Port to serve on", args: { name: "port", parse: int.as("port") } },
  ],
  action({ args, options }) {
    is<{ width: number; height: number } | undefined>()(args[0]);
    is<{ amount: number; unit: "s" | "m" | "h" | "d" } | undefined>()(options.get("--every"));
    is<number | "auto" | undefined>()(options.get("--jobs"));
    console.log(
      JSON.stringify([args[0], options.get("--every"), options.get("--jobs"), options.get("--scope")]),
    );
  },
});

test("an action receives what each parser gives", async () => {
  const { stdout } = await captureConsole(() =>
    run(watch, ["3x4", "--every", "10s", "--jobs", "auto", "--scope", "read,write"]),
  );
  expect(JSON.parse(stdout)).toEqual([
    { width: 3, height: 4 },
    { amount: 10, unit: "s" },
    "auto",
    ["read", "write"],
  ]);
});

test("a rejected value is reported with what the parser expected", async () => {
  const { stderr } = await captureConsole(() => run(watch, ["--every", "10x", "--jobs", "0"]));
  expect(stderr).toContain('Invalid value "10x" for --every: expected s | m | h | d after "10"');
  expect(stderr).toContain('Invalid value "0" for --jobs: expected an integer from 1 to 64 or auto');
});

test("help shows the pattern of a parser, and lists the values of a choice", async () => {
  const { stdout } = await captureConsole(() => run(watch, ["-h"]));
  expect(stdout).toContain("  size  Size of the window (<width>x<height>)");
  expect(stdout).toContain("  --every <duration>  Time between runs (<int>(s|m|h|d))");
  expect(stdout).toContain("  --jobs <n>          How many to run at once (auto | <int>)");
  expect(stdout).toContain("  --scope <scopes>    What it may do ((read|write|admin),...)");
  expect(stdout).toContain("  --color <when>      Colour the output (auto | always | never)");
  expect(stdout).toContain("  --port <port>       Port to serve on (int)");
});

/** What completion offers for the word `partial` after `before`. */
async function completions(before: readonly string[], partial: string): Promise<string[]> {
  const withCompletion: Spec = { ...watch, subcommands: [CLI.completion] };
  const { stdout } = await captureConsole(() =>
    run(withCompletion, ["completion", "complete", "--shell", "fish", "--", ...before, partial]),
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[0]);
}

test("completion offers what a partly typed value could become", async () => {
  expect(await completions(["--every"], "10")).toEqual(["10s", "10m", "10h", "10d"]);
  expect(await completions([], "--every=10")).toEqual([
    "--every=10s",
    "--every=10m",
    "--every=10h",
    "--every=10d",
  ]);
  expect(await completions(["--scope"], "read,")).toEqual(["read,read", "read,write", "read,admin"]);
  expect(await completions(["--color"], "")).toEqual(["auto", "always", "never"]);
  expect(await completions(["--color"], "al")).toEqual(["always"]);
  expect(await completions(["--jobs"], "")).toEqual(["auto"]);
});
