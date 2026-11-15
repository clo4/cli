// Make the working docs the released docs of the current major, and save the
// API model they're released with. Run it when tagging a release:
//
//   pnpm --filter docs release
//
// The working docs are in content/docs/next and describe the main branch. A
// released version is in content/docs/v<major>, and its reference renders
// from api-models/v<major>.json, so both stay as they were at the release
// until this runs again.
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const { version } = JSON.parse(await readFile("../package.json", "utf8"));
const major = version.split(".")[0];
if (!/^\d+$/.test(major)) {
  throw new Error(`Cannot determine the documentation version from ${version}`);
}
const released = `content/docs/v${major}`;

// Replace the released pages with the working ones. The reference is
// generated, so it isn't copied.
await mkdir(released, { recursive: true });
for (const entry of await readdir(released)) {
  if (entry !== "reference") {
    await rm(`${released}/${entry}`, { recursive: true });
  }
}
for (const entry of await readdir("content/docs/next")) {
  if (entry !== "reference") {
    await cp(`content/docs/next/${entry}`, `${released}/${entry}`, { recursive: true });
  }
}

// The released version has its own name in the version menu.
const meta = JSON.parse(await readFile(`${released}/meta.json`, "utf8"));
meta.title = `v${major}`;
meta.description = `Version ${major}`;
await writeFile(`${released}/meta.json`, `${JSON.stringify(meta, null, 2)}\n`);

// The site's root goes to the newest released version.
await writeFile("_redirects", `/cli /cli/v${major} 301\n/cli/ /cli/v${major} 301\n`);

const script = fileURLToPath(new URL("generate-reference.mjs", import.meta.url));
const { stdout } = await promisify(execFile)(process.execPath, [script, "--freeze"]);
process.stdout.write(stdout);
console.log(`Released the docs for ${version} as v${major}`);
