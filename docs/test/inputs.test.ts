import { expect, test } from "vitest";
import { analyse } from "@/playground/analyse";
import { actionInput } from "@/playground/inputs";
import { spec as greet } from "@/playground/scenarios/greet";

const read = async (line: string) => actionInput(await analyse(greet, line, (name) => name));

test("the input is the arguments by position, and the options by how the action reads them", async () => {
  expect(await read("greet Ada --shout")).toEqual({
    kind: "input",
    args: [{ name: "name", value: "Ada" }],
    options: [
      { name: "--times", read: "get", value: 1, isDefault: true },
      { name: "--shout", read: "has", value: true, isDefault: false },
    ],
  });
});

test("an option with an action of its own runs in place of the command's", async () => {
  expect(await read("greet --help")).toEqual({ kind: "replaced", option: "--help" });
});

test("a line that doesn't parse has no input", async () => {
  expect(await read("greet --times 9")).toBeNull();
});
