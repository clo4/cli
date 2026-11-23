import * as CLI from "@clo4/cli";
import { expect, test } from "vitest";
import { accept, move, offersMore, preview, suggest, tab } from "@/playground/menu";
import { spec as greet } from "@/playground/scenarios/greet";

test("an option's names are one item, which inserts the longest that fits the word", async () => {
  const menu = await suggest(greet, "greet -", 7);
  expect(menu.items.map((item) => [item.names, item.insert])).toEqual([
    [["-t", "--times"], "--times"],
    [["-s", "--shout"], "--shout"],
    [["-h", "--help"], "--help"],
  ]);
  const short = await suggest(greet, "greet -t", 8);
  expect(short.items.map((item) => item.insert)).toEqual(["-t"]);
});

test("the first word is the program", async () => {
  expect((await suggest(greet, "gr", 2)).items.map((item) => item.insert)).toEqual(["greet"]);
});

test("nothing is selected at first, and accepting takes the first item", async () => {
  const menu = await suggest(greet, "greet --t", 9);
  expect(menu.selected).toBe(-1);
  expect(preview(menu)).toBe("imes");
  expect(accept("greet --t", 9, menu)).toEqual({ line: "greet --times ", caret: 14 });
});

test("moving the selection wraps around: forward from nothing is the first, and back the last", async () => {
  const menu = await suggest(greet, "greet -", 7);
  const last = menu.items.length - 1;
  expect(move(menu, 1).selected).toBe(0);
  expect(move(menu, -1).selected).toBe(last);
  expect(move(move(menu, 1), -1).selected).toBe(last);
});

test("Tab completes as far as the items agree, then moves through them", async () => {
  const line = "greet --";
  const menu = await suggest(greet, line, line.length);
  // --help, --times and --shout agree on nothing past `--`, so Tab selects.
  expect(tab(line, line.length, menu)).toMatchObject({ selected: 0 });
  const dash = await suggest(greet, "greet -", 7);
  expect(tab("greet -", 7, dash)).toEqual({ line: "greet --", caret: 8 });
});

test("Tab accepts the only item", async () => {
  expect(tab("greet --t", 9, await suggest(greet, "greet --t", 9))).toEqual({
    line: "greet --times ",
    caret: 14,
  });
});

test("an item that's typed already offers nothing more on its own", async () => {
  expect(offersMore(await suggest(greet, "greet --times", 13))).toBe(false);
  expect(offersMore(await suggest(greet, "greet --t", 9))).toBe(true);
});

test("an incomplete item is accepted with no space after it", async () => {
  const size = CLI.spec({ name: "size", args: { name: "size", parse: CLI.seq(CLI.uint, "x", CLI.uint) } });
  expect(accept("size 1920", 9, await suggest(size, "size 1920", 9)).line).toBe("size 1920x");
});
