import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { rolldown } from "rolldown";
import { build } from "tsdown";
import { afterAll, beforeAll, expect, test } from "vitest";

import config from "../tsdown.config.js";
import * as CLI from "../src/index.js";

// The index bundle as it's published: built with the package's own config.
const dir = mkdtempSync(join(tmpdir(), "clo4-cli-dist-"));
const files = () => readdirSync(dir).filter((file) => file.endsWith(".js"));

beforeAll(async () => {
  const index = (Array.isArray(config) ? config : [config]).find((entry) =>
    [entry.entry].flat().includes("src/index.ts"),
  );
  await build({ ...index, config: false, outDir: dir, dts: false, sourcemap: false, logLevel: "silent" });
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
}, 30_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("a run loads one file", () => {
  expect(files()).toEqual(["index.js"]);
  expect(readFileSync(join(dir, "index.js"), "utf8")).not.toMatch(/^import[^(]/m);
});

test("index.js exports the public names and nothing else", async () => {
  const built = (await import(pathToFileURL(join(dir, "index.js")).href)) as Record<string, unknown>;
  expect(Object.keys(built).sort()).toEqual(Object.keys(CLI).sort());
});

test("a CLI without parsers or completion bundles without their code", async () => {
  // What a bundler keeps of index.js for a spec that uses neither: anything
  // that runs when the module loads stays, whether the spec uses it or not.
  const entry = join(dir, "cli.js");
  writeFileSync(
    entry,
    `import * as CLI from "./index.js";
CLI.run(CLI.spec({ name: "x", options: [CLI.help], subcommands: [CLI.helpCommand], action() {} }));`,
  );
  const result = await rolldown({ input: entry, platform: "node", logLevel: "silent" });
  const { output } = await result.generate({ format: "esm", codeSplitting: false, minify: true });
  const code = output[0].code;
  // The vendor of a built-in parser, and the shells completion writes scripts for.
  expect(code).not.toContain("@clo4/cli");
  expect(code).not.toContain("nushell");
});
