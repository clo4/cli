import { expect, test } from "vitest";
import { accept, move, suggest } from "@/playground/menu";
import { spec as greet } from "@/playground/scenarios/greet";
import * as CLI from "@clo4/cli";

test("the menu offers what the word at the caret can become", async () => {
  const menu = await suggest(greet, "greet --t", 9);
  expect(menu.word).toEqual({ text: "--t", start: 6, end: 9 });
  expect(menu.items.map((item) => item.insert)).toEqual(["--times"]);
});

test("the first word is the program", async () => {
  expect((await suggest(greet, "gr", 2)).items.map((item) => item.insert)).toEqual(["greet"]);
});

test("moving the selection wraps around", async () => {
  const menu = await suggest(greet, "greet -", 7);
  expect(move(menu, -1).selected).toBe(menu.items.length - 1);
  expect(move(move(menu, -1), 1).selected).toBe(0);
});

test("accepting puts the item in place of the word, with a space unless it's incomplete", async () => {
  expect(accept("greet --t", 9, await suggest(greet, "greet --t", 9))).toEqual({
    line: "greet --times ",
    caret: 14,
  });
  const size = CLI.spec({ name: "size", args: { name: "size", parse: CLI.seq(CLI.uint, "x", CLI.uint) } });
  expect(accept("size 1920", 9, await suggest(size, "size 1920", 9)).line).toBe("size 1920x");
});
