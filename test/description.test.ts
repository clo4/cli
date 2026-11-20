import { expect, test } from "vitest";

import * as CLI from "../src/index.js";
import { describeParser } from "../src/description.js";
import type { StandardSchemaV1 } from "../src/types.js";
import { captureConsole, run } from "./helpers.js";

/** A schema from another library that describes itself as `described`, and accepts anything. */
function describedAs(described: Record<string, unknown> | undefined): StandardSchemaV1<string, string> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value: String(value) }),
      jsonSchema: described && { input: () => described },
    },
  };
}

test("describeParser: an argument without a parser has no description", () => {
  expect(describeParser({ name: "file" })).toBeUndefined();
});

test("describeParser: a built-in parser and a schema that says the same are described the same", () => {
  const pairs = [
    [CLI.choice("debug", "release"), describedAs({ type: "string", enum: ["debug", "release"] })],
    [CLI.number({ min: 1, max: 5, int: true }), describedAs({ type: "integer", minimum: 1, maximum: 5 })],
    [CLI.number({ min: 0 }), describedAs({ type: "number", minimum: 0 })],
  ] as const;
  for (const [builtIn, other] of pairs) {
    const a = describeParser({ parse: builtIn })!;
    const b = describeParser({ parse: other })!;
    expect([a.choices, a.range, a.constraint]).toEqual([b.choices, b.range, b.constraint]);
  }
});

test("describeParser: a built-in parser says what JSON Schema has no words for", () => {
  const jobs = describeParser({ parse: CLI.choice("auto", CLI.int) })!;
  expect(jobs.choices).toEqual(["auto"]);
  expect(jobs.range).toBeUndefined();
  expect(jobs.constraint).toEqual(["auto", "<int>"]);
  expect(jobs.complete("a")).toEqual([{ value: "auto" }]);

  const size = describeParser({ parse: CLI.seq(CLI.uint.as("width"), "x", CLI.uint.as("height")) })!;
  expect(size.choices).toBeUndefined();
  expect(size.constraint).toEqual(["<width>x<height>"]);
  expect(size.complete("1920")).toEqual([{ value: "1920x", open: true }]);

  const mapped = describeParser({ parse: CLI.choice("a", CLI.choice("b", "c")).map((value) => value) })!;
  expect(mapped.choices).toEqual(["a", "b", "c"]);
});

test("describeParser: a schema that can't describe itself says nothing", () => {
  const throws: StandardSchemaV1<string, string> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value: String(value) }),
      jsonSchema: {
        input: () => {
          throw new Error("no words for it");
        },
      },
    },
  };
  for (const parse of [describedAs(undefined), throws]) {
    const description = describeParser({ parse })!;
    expect([description.choices, description.range, description.constraint]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(description.complete("")).toEqual([]);
  }
});

test("a rejected value is compared with the strings a choice lists beside a parser", async () => {
  const spec = CLI.spec({
    name: "make",
    options: [{ name: "--jobs", args: { name: "n", parse: CLI.choice("auto", CLI.int) } }],
    action: () => 0,
  });
  const { stderr } = await captureConsole(() => run(spec, ["--jobs", "atuo"]));
  expect(stderr).toContain("Did you mean 'auto'?");
});
