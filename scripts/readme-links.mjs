// Point the README's documentation links at the released docs or the working
// docs.
//
// The README in the repository describes the main branch, so its links go to
// https://clo4.net/cli/docs/next. The README published to npm describes a
// release, so `prepack` runs this with `released` to point the links at that
// release's docs, such as /cli/docs/v6, and `postpack` runs it with `next` to
// put them back.
import { readFile, writeFile } from "node:fs/promises";

const [target] = process.argv.slice(2);
if (target !== "released" && target !== "next") {
  throw new Error("Use `released` or `next`");
}
const root = new URL("..", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const released = `v${version.split(".")[0]}`;
const [from, to] = target === "released" ? ["next", released] : [released, "next"];

const file = new URL("README.md", root);
const readme = await readFile(file, "utf8");
// A link ends at the version, or carries on to a page.
const links = new RegExp(`(https://clo4\\.net/cli/docs/)${from}(?=[/)#\\s]|$)`, "gm");
const count = readme.match(links)?.length ?? 0;
if (target === "released" && count === 0) {
  throw new Error("The README has no links to https://clo4.net/cli/docs/next to point at the release");
}
await writeFile(file, readme.replace(links, `$1${to}`));
console.log(`Pointed ${count} README links at /cli/docs/${to}`);
