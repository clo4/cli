// Runs after `pnpm version` has committed and tagged the bump.
//
// A release commit is always named `Release <version>`. `pnpm version` names
// it `<version>` unless it's given `--message "Release %s"`, and it has no
// setting for that, so the commit is renamed here and the tag moved to it.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const message = `Release ${version}`;
const tag = `v${version}`;

if (git("log", "-1", "--format=%s") !== message) {
  git("commit", "--amend", "--no-verify", "--message", message);
  git("tag", "--force", tag);
}
console.log(`${message} is committed and tagged as ${tag}, and nothing is pushed.`);
console.log("Pushing the branch deploys the docs, and pushing the tag publishes to npm.");
