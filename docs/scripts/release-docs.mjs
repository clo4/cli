import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const { version } = JSON.parse(await readFile("../package.json", "utf8"));
const major = version.split(".")[0];
if (!/^\d+$/.test(major)) {
  throw new Error(`Cannot determine the documentation version from ${version}`);
}
const released = `content/docs/v${major}`;

await rm(released, { recursive: true, force: true });
await mkdir(released, { recursive: true });
await cp("content/docs/next", released, { recursive: true });

const meta = JSON.parse(await readFile(`${released}/meta.json`, "utf8"));
meta.title = `v${major}`;
meta.description = `Version ${major}`;
await writeFile(`${released}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

const majors = (await readdir("content/docs"))
  .filter((dir) => /^v\d+$/.test(dir))
  .map((dir) => Number(dir.slice(1)))
  .sort((a, b) => b - a);
// Pages of next that moved into groups in 7.0. Links to the old paths are out
// there, such as in the v7 blog post.
const moved = {
  actions: "concepts/actions",
  arguments: "concepts/arguments",
  "choosing-a-cli-library": "introduction/choosing-a-cli-library",
  compatibility: "reference/compatibility",
  "completion-generators": "guides/suggest-values",
  "help-and-completion": "concepts/help-and-completion",
  "install-completion": "guides/install-completion",
  "loading-commands": "guides/loading-commands",
  options: "concepts/options",
  "organizing-commands": "guides/organizing-commands",
  "parser-settings": "concepts/parser-settings",
  parsers: "concepts/parsers",
  "parsing-behavior": "reference/parsing-behavior",
  performance: "introduction/performance",
  subcommands: "concepts/subcommands",
  "suggest-values": "guides/suggest-values",
  testing: "guides/testing",
  "testing-commands": "guides/testing-commands",
  "wrapping-commands": "guides/wrapping-commands",
};
const redirects = [];
for (const [from, to] of Object.entries(moved)) {
  redirects.push(
    `/cli/next/${from} /cli/docs/next/${to} 301`,
    `/cli/docs/next/${from} /cli/docs/next/${to} 301`,
  );
}
redirects.push("/cli/next /cli/docs/next 301", "/cli/next/* /cli/docs/next/:splat 301");
for (const n of majors) {
  const to = n === majors[0] ? "/cli/docs" : `/cli/docs/v${n}`;
  redirects.push(`/cli/v${n} ${to} 301`, `/cli/v${n}/* ${to}/:splat 301`);
  if (n === majors[0]) {
    redirects.push(`/cli/docs/v${n} /cli/docs 302`, `/cli/docs/v${n}/* /cli/docs/:splat 302`);
  }
}
await writeFile("_redirects", `${redirects.join("\n")}\n`);

const unreleased = await readFile("content/changelog/unreleased.mdx", "utf8");
const notes = unreleased.replace(/^---\n[\s\S]*?\n---\n/, "");
await writeFile(
  `content/changelog/${version}.mdx`,
  `---\ntitle: "${version}"\ndate: ${new Date().toISOString()}\n---\n${notes}`,
);
await writeFile("content/changelog/unreleased.mdx", '---\ntitle: "Unreleased"\n---\n');

console.log(`Released the docs and changelog for ${version}, as v${major}`);
