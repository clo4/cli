import { expect, test } from "vitest";
import { analyse } from "@/playground/analyse";
import { spec as build } from "@/playground/scenarios/build";
import { spec as greet } from "@/playground/scenarios/greet";
import { spec as serve } from "@/playground/scenarios/serve";

const notFound = (name: string) => `not found: ${name}`;

test("each word is what the parser reads it as", async () => {
  const { tokens } = await analyse(greet, "greet Ada --times 2", notFound);
  expect(tokens.map((t) => t.kind)).toEqual(["program", "argument", "option", "value"]);
  expect(tokens[1].pieces).toEqual([greet.args]);
});

test("a word of short options is each of them", async () => {
  const { tokens } = await analyse(build, "demo build -ww", notFound);
  expect(tokens[2].pieces).toHaveLength(2);
});

test("a line that parses gives the action's input and what it prints", async () => {
  const { problems, result, printed } = await analyse(greet, "greet Ada --times 2", notFound);
  expect(problems).toEqual([]);
  expect(result?.args).toEqual(["Ada"]);
  expect(printed).toEqual([
    { fd: 1, text: "Hello, Ada!\n" },
    { fd: 1, text: "Hello, Ada!\n" },
  ]);
});

test("each problem is on the word it's about", async () => {
  const { tokens, problems, result } = await analyse(serve, "serve --port 70000 --mode fast", notFound);
  expect(result).toBeNull();
  expect(problems.map((p) => p.message)).toHaveLength(3);
  expect(tokens[2].problems[0].message).toMatch(/70000/);
  expect(tokens[4].problems[0].message).toMatch(/fast/);
});

test("a program with another name isn't found", async () => {
  const { tokens, printed } = await analyse(greet, "great Ada", notFound);
  expect(tokens[0].problems[0].message).toBe("not found: great");
  expect(printed).toEqual([{ fd: 2, text: "not found: great\n" }]);
  expect(tokens[1].kind).toBe("unread");
});
