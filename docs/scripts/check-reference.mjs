import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const docs = fileURLToPath(new URL("..", import.meta.url));
const repository = path.dirname(docs);
const fixture = await mkdtemp(path.join(tmpdir(), "cli-reference-check-"));
const fixtureDocs = path.join(fixture, "docs");
const script = path.join(fixtureDocs, "scripts/generate-reference.mjs");
const output = (version, file) => path.join(fixtureDocs, `content/docs/${version}/reference`, file);
async function generate(...args) {
  return execute(process.execPath, [script, ...args], { maxBuffer: 2 * 1024 * 1024 });
}

try {
  await mkdir(path.join(fixtureDocs, "scripts"), { recursive: true });
  await cp(path.join(docs, "scripts/generate-reference.mjs"), script);
  await cp(path.join(docs, "typedoc.json"), path.join(fixtureDocs, "typedoc.json"));
  await cp(path.join(repository, "src"), path.join(fixture, "src"), { recursive: true });
  for (const name of ["tsconfig.json", "tsconfig.base.json"]) {
    await cp(path.join(repository, name), path.join(fixture, name));
  }
  // TypeDoc resolves its plugin relative to the fixture's docs workspace.
  const { symlink } = await import("node:fs/promises");
  await symlink(path.join(docs, "node_modules"), path.join(fixtureDocs, "node_modules"), "dir");
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({
      name: "@clo4/cli",
      type: "module",
      version: "7.0.0",
    }),
  );
  for (const version of ["v6", "v7"]) {
    const directory = path.join(fixtureDocs, "content/docs", version);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "meta.json"), "{}");
  }
  const models = path.join(fixtureDocs, "api-models");
  await mkdir(models);
  const archive = path.join(models, "v6.json");
  await cp(path.join(docs, "api-models/v6.json"), archive);
  const index = path.join(fixture, "src/index.ts");
  await writeFile(
    index,
    `${await readFile(index, "utf8")}\n/** Only in the new source. */\nexport function futureOnly(value: string): number { return value.length; }\n`,
  );

  await generate();
  for (const version of ["v6", "v7"]) {
    for (const name of ["NonEmptyArray", "SingleOrArray", "SingleOrArrayOrEmpty"]) {
      const page = await readFile(output(version, `cli/type-aliases/${name}.mdx`), "utf8");
      assert.ok(page.includes(`title: "${name}<T>"`), `${version}: unescaped title for ${name}`);
    }
  }
  const oldIndex = await readFile(output("v6", "cli/index.mdx"), "utf8");
  assert.doesNotMatch(oldIndex, /futureOnly/);
  assert.match(await readFile(output("v7", "cli/functions/futureOnly.mdx"), "utf8"), /value: string/);
  console.log("PASS: archived v6 uses its model; active v7 uses source");

  const savedArchive = await readFile(archive);
  await rm(archive);
  await assert.rejects(generate(), /Cannot load api-models\/v6\.json/);
  assert.equal(await readFile(output("v6", "cli/index.mdx"), "utf8"), oldIndex);
  await writeFile(archive, savedArchive);
  console.log("PASS: a missing archive fails before generated pages change");

  await generate("--freeze");
  await writeFile(index, (await readFile(index, "utf8")).replaceAll("futureOnly", "changedAfterFreeze"));
  await generate("--frozen");
  assert.match(await readFile(output("v7", "cli/functions/futureOnly.mdx"), "utf8"), /futureOnly/);
  assert.doesNotMatch(await readFile(output("v7", "cli/index.mdx"), "utf8"), /changedAfterFreeze/);
  console.log("PASS: frozen rendering ignores later source changes");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
