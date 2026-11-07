import { expect, test } from "vitest";

import { asArray, makeArray, makeArray1 } from "../src/util.js";

test("makeArray transforms input to arrays", () => {
  expect(makeArray(undefined)).toEqual([]);
  expect(makeArray([])).toEqual([]);
  expect(makeArray(1)).toEqual([1]);
  expect(makeArray([1])).toEqual([1]);
});

test("asArray normalizes without copying existing arrays", () => {
  const source = [1, 2];
  expect(asArray(undefined)).toEqual([]);
  expect(asArray(1)).toEqual([1]);
  // An existing array is returned as-is (no defensive copy).
  expect(asArray(source)).toBe(source);
});

test("makeArray1 transforms input to non-empty arrays", () => {
  expect(makeArray1(1)).toEqual([1]);
  expect(makeArray1([1])).toEqual([1]);
});
