import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));

async function exportsOf(file) {
  const source = await readFile(file, "utf8");
  const names = new Set();
  for (const [, list] of source.matchAll(/export (?:type )?\{([^}]*)\}/g)) {
    for (const entry of list.split(",")) {
      const name = entry
        .trim()
        .split(/\s+as\s+/)
        .at(-1);
      if (name) {
        names.add(name);
      }
    }
  }
  for (const [, name] of source.matchAll(/export (?:const|function|class|interface|type) (\w+)/g)) {
    names.add(name);
  }
  return names;
}

const dir = "content/docs/next/reference";
let pages = "";
for (const file of await readdir(dir)) {
  if (file.endsWith(".mdx")) {
    pages += await readFile(`${dir}/${file}`, "utf8");
  }
}

const documented = (name) =>
  new RegExp(`^#+ \`${name}\\b`, "m").test(pages) || new RegExp(`^\\| \`${name}\\b`, "m").test(pages);

const missing = [];
for (const file of ["../src/index.ts", "../src/testing.ts", "../src/analyze.ts"]) {
  for (const name of await exportsOf(file)) {
    if (name !== "default" && !documented(name)) {
      missing.push(`${name} (${file.slice(3)})`);
    }
  }
}

if (missing.length) {
  console.error(`These exports have no heading or table row in ${dir}:\n  ${missing.join("\n  ")}`);
  process.exit(1);
}
console.log("Every public export is in the reference.");
