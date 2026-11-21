import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

test("a run loads one file, and completion's command is a chunk of its own", () => {
  const chunks = files().filter((file) => file !== "index.js");
  expect(chunks).toHaveLength(1);
  expect(chunks[0]).toMatch(/^completion-command-.*\.js$/);
  // Only `completion` refers to the chunk, with `import()`.
  expect(readFileSync(join(dir, "index.js"), "utf8")).not.toMatch(/^import[^(]/m);
});

test("index.js exports the public names and nothing else", async () => {
  const built = (await import(pathToFileURL(join(dir, "index.js")).href)) as Record<string, unknown>;
  expect(Object.keys(built).sort()).toEqual(Object.keys(CLI).sort());
});

test("completion's command imports only public names, from index.js", () => {
  const chunk = files().find((file) => file !== "index.js")!;
  const code = readFileSync(join(dir, chunk), "utf8");
  const imports = [...code.matchAll(/\bimport\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)];
  expect(imports.map(([, , from]) => from)).toEqual(["./index.js"]);
  const names = imports[0][1].split(",").map((binding) => binding.trim().split(/\s+as\s+/)[0]);
  for (const name of names) {
    expect(Object.keys(CLI)).toContain(name);
  }
  // Nothing else is imported, statically or with `import()`.
  expect(code.match(/\bimport\b/g)).toHaveLength(1);
});
