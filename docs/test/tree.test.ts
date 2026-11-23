import { expect, test } from "vitest";
import { specRanges } from "@/playground/ranges";
import { spec as build } from "@/playground/scenarios/build";
import source from "@/playground/scenarios/build.ts?raw";
import { specTree } from "@/playground/tree";

const tree = specTree(build, specRanges(source));
const subcommand = build.subcommands![0] as { args: object };

test("a line is the innermost piece declared on it", () => {
  const line = source.split("\n").findIndex((l) => l.includes('name: "input"')) + 1;
  expect(tree.at(line)?.piece).toBe(subcommand.args);
});

test("a piece knows the piece it's declared in", () => {
  expect(tree.node(subcommand.args as never)?.parent?.piece).toBe(subcommand);
});
