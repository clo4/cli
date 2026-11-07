import { expect, test } from "vitest";

import { closestChoice } from "../src/suggest.js";

const options = ["--out", "--mode", "--watch", "-v", "--verbose", "-h", "--help"];
const commands = ["build", "b", "remote", "config", "completion", "help"];

test("suggest: typos within one edit per three characters", () => {
  expect(closestChoice("--uot", options)).toBe("--out");
  expect(closestChoice("--ouy", options)).toBe("--out");
  expect(closestChoice("--mdoe", options)).toBe("--mode");
  expect(closestChoice("--wacth", options)).toBe("--watch");
  expect(closestChoice("biuld", commands)).toBe("build");
  expect(closestChoice("remtoe", commands)).toBe("remote");
  expect(closestChoice("confg", commands)).toBe("config");
});

test("suggest: a unique prefix", () => {
  expect(closestChoice("--verb", options)).toBe("--verbose");
  expect(closestChoice("comp", commands)).toBe("completion");
});

test("suggest: a unique abbreviation", () => {
  expect(closestChoice("bld", commands)).toBe("build");
  expect(closestChoice("cfg", commands)).toBe("config");
  expect(closestChoice("--wtch", options)).toBe("--watch");
});

test("suggest: nothing for unrelated or very short input", () => {
  expect(closestChoice("--shell", ["-h", "--help"])).toBeUndefined();
  expect(closestChoice("--force", options)).toBeUndefined();
  expect(closestChoice("deploy", commands)).toBeUndefined();
  expect(closestChoice("--x", options)).toBeUndefined();
  expect(closestChoice("z", commands)).toBeUndefined();
  expect(closestChoice("anything", [])).toBeUndefined();
});

test("suggest: the first of equally close choices wins", () => {
  expect(closestChoice("cat", ["bat", "cap"])).toBe("bat");
});

test("suggest: the names of one command or option are one choice", () => {
  const remote = ["remote", "rem"];
  expect(closestChoice("re", [remote, "build"])).toBe("remote");
  expect(closestChoice("re", [remote, "rebase"])).toBeUndefined();
  expect(closestChoice("--col", [["--color", "--colour"], "--verbose"])).toBe("--color");
  expect(closestChoice("--clr", [["--color", "--colour"]])).toBe("--color");
  expect(closestChoice("rmeote", [remote])).toBe("remote");
});
