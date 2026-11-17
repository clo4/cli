import { type } from "arktype";
import { expect, test } from "vitest";
import * as v from "valibot";
import * as z from "zod";

import * as CLI from "../src/index.js";
import { captureConsole, run } from "./helpers.js";

/** Fails to compile unless `Actual` is exactly `Expected`. */
function is<Expected>() {
  return <Actual>(
    _value: Actual,
    ..._same: (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2 ? [] : [never]
  ): void => {};
}

let seen: unknown[] = [];

// The same command with each library's schemas: a port from 1 to 65535, and
// one of two modes.
const spec = CLI.spec({
  name: "demo",
  subcommands: [
    CLI.completion,
    {
      name: "zod",
      description: "Schemas from Zod",
      options: [
        CLI.help,
        {
          name: "--port",
          description: "Port",
          isRequired: true,
          args: { name: "port", parse: z.coerce.number().int().min(1).max(65535) },
        },
        {
          name: "--mode",
          description: "Mode",
          args: { name: "mode", default: "debug", parse: z.enum(["debug", "release"]) },
        },
        // A schema with a callback written in the spec.
        {
          name: "--length",
          description: "Length",
          args: { name: "text", parse: z.string().transform((text) => text.length) },
        },
      ],
      action({ options }) {
        is<number>()(options.get("--port"));
        is<"debug" | "release">()(options.get("--mode"));
        is<number | undefined>()(options.get("--length"));
        seen = [options.get("--port"), options.get("--mode"), options.get("--length")];
      },
    },
    {
      name: "valibot",
      description: "Schemas from Valibot",
      options: [
        CLI.help,
        {
          name: "--port",
          description: "Port",
          isRequired: true,
          args: {
            name: "port",
            parse: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1), v.maxValue(65535)),
          },
        },
        {
          name: "--mode",
          description: "Mode",
          args: { name: "mode", default: "debug", parse: v.picklist(["debug", "release"]) },
        },
      ],
      action({ options }) {
        is<number>()(options.get("--port"));
        is<"debug" | "release">()(options.get("--mode"));
        seen = [options.get("--port"), options.get("--mode")];
      },
    },
    {
      name: "arktype",
      description: "Schemas from ArkType",
      options: [
        CLI.help,
        {
          name: "--port",
          description: "Port",
          isRequired: true,
          args: { name: "port", parse: type("string.integer.parse").to("1 <= number <= 65535") },
        },
        {
          name: "--mode",
          description: "Mode",
          args: { name: "mode", default: "debug", parse: type("'debug' | 'release'") },
        },
      ],
      action({ options }) {
        is<number>()(options.get("--port"));
        is<"debug" | "release">()(options.get("--mode"));
        seen = [options.get("--port"), options.get("--mode")];
      },
    },
  ],
});

// A schema that only takes a number can't parse a value from a command line.
// @ts-expect-error
CLI.spec({ name: "bad", args: { name: "n", parse: z.number() } });

/** What completion offers for the word after `before`. */
async function completions(before: readonly string[]): Promise<string[]> {
  const { stdout } = await captureConsole(() =>
    run(spec, ["completion", "complete", "--shell", "fish", "--", ...before, ""]),
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t")[0]);
}

for (const library of ["zod", "valibot", "arktype"]) {
  test(`${library}: a schema parses a value, and its default`, async () => {
    seen = [];
    expect(await run(spec, [library, "--port", "3000"])).toBe(0);
    expect(seen.slice(0, 2)).toEqual([3000, "debug"]);
    expect(await run(spec, [library, "--port", "80", "--mode", "release"])).toBe(0);
    expect(seen.slice(0, 2)).toEqual([80, "release"]);
  });

  test(`${library}: every rejected value is reported with the schema's message`, async () => {
    seen = [];
    const { code, stderr } = await captureConsole(() =>
      run(spec, [library, "--port", "70000", "--mode", "fast"]),
    );
    expect(code).toBe(1);
    expect(seen).toEqual([]);
    const errors = stderr.split("\n").filter((line) => line.startsWith("Error: "));
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^Error: Invalid value "70000" for --port: \S/);
    expect(errors[1]).toMatch(/^Error: Invalid value "fast" for --mode: \S/);
  });
}

test("zod: a schema with a callback written in the spec parses", async () => {
  await run(spec, ["zod", "--port", "1", "--length", "four"]);
  expect(seen).toEqual([1, "debug", 4]);
});

test("zod and arktype: help shows the values a schema lists", async () => {
  for (const library of ["zod", "arktype"]) {
    const { stdout } = await captureConsole(() => run(spec, [library, "--help"]));
    expect(stdout, library).toMatch(/--mode <mode> +Mode \(debug \| release, default: debug\)\n/);
  }
});

test("zod: help shows the range of a coerced number", async () => {
  const { stdout } = await captureConsole(() => run(spec, ["zod", "--help"]));
  expect(stdout).toMatch(/--port <port> +Port \(int from 1 to 65535\)\n/);
});

test("arktype: a schema that parses a string describes the string, so help shows no range", async () => {
  const { stdout } = await captureConsole(() => run(spec, ["arktype", "--help"]));
  expect(stdout).toMatch(/--port <port> +Port\n/);
});

test("zod and arktype: completion offers the values", async () => {
  expect(await completions(["zod", "--mode"])).toEqual(["debug", "release"]);
  expect(await completions(["arktype", "--mode"])).toEqual(["debug", "release"]);
});

test("valibot: a schema doesn't describe itself, so help and completion add nothing", async () => {
  const { stdout } = await captureConsole(() => run(spec, ["valibot", "--help"]));
  expect(stdout).toContain("--port <port>  Port\n");
  expect(stdout).toContain("--mode <mode>  Mode (default: debug)\n");
  expect(await completions(["valibot", "--mode"])).toEqual([]);
});
