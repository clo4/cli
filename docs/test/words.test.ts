import { expect, test } from "vitest";
import { wordAt, words } from "@/playground/words";

test("words split at spaces outside quotes, and read quotes and escapes", () => {
  expect(words(`greet  "Ada Lovelace" it\\'s 'a b'`)).toEqual([
    { text: "greet", start: 0, end: 5 },
    { text: "Ada Lovelace", start: 7, end: 21 },
    { text: "it's", start: 22, end: 27 },
    { text: "a b", start: 28, end: 33 },
  ]);
});

test("the word at the caret is the one it ends, or an empty one after a space", () => {
  expect(wordAt("greet --ti", 10).word).toEqual({ text: "--ti", start: 6, end: 10 });
  expect(wordAt("greet --ti", 10).before.map((w) => w.text)).toEqual(["greet"]);
  expect(wordAt("greet ", 6).word).toEqual({ text: "", start: 6, end: 6 });
  expect(wordAt("greet ", 6).before.map((w) => w.text)).toEqual(["greet"]);
});
