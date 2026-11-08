// Compares the parser with the one at another git ref on random specs and
// command lines, to catch any change in behavior. It only runs when
// FUZZ_AGAINST names a ref, so it's skipped in the normal test run:
//
//   FUZZ_AGAINST=HEAD pnpm fuzz        uncommitted changes against the last commit
//   FUZZ_AGAINST=v2.0.0 pnpm fuzz      this branch against a release
//
// FUZZ_CASES, FUZZ_SEED and FUZZ_CASE work as in test/fuzz.test.ts.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, expect, test } from "vitest";

import { usage } from "../src/subcommands.js";
import { parse, readNext } from "../src/parse.js";
import type { Action, Spec } from "../src/types.js";
import { caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { OPTION_NAMES, generator, shrink } from "./fuzz/generate.js";
import { attempt, difference, nextDifference } from "./fuzz/snapshot.js";
import type { AnyNextToken } from "./fuzz/snapshot.js";

const ref = process.env.FUZZ_AGAINST;
const dir = ref ? mkdtempSync(join(tmpdir(), "clo4-cli-fuzz-")) : "";
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.skipIf(!ref)(`parse and readNext behave the same as at ${ref}`, async () => {
  const archive = execFileSync("git", ["archive", ref!, "src"], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  // A plain path keeps one module instance per file, shared with their parse.ts.
  const load = (file: string) => import(join(dir, "src", file));
  const theirs = (await load("parse.ts")) as {
    parse: typeof parse;
    readNext?: (spec: Spec, input: readonly string[], partial: string) => AnyNextToken;
  };
  // The built-in usage action moved from help.ts to subcommands.ts.
  const theirSubcommands = (await load("subcommands.ts").catch(() => ({}))) as { usage?: Action };
  const theirUsage = theirSubcommands.usage ?? ((await load("help.ts")) as { usage: Action }).usage;

  // Each copy of the source has its own built-in usage action.
  const sameAction = (x: Action, y: Action) => x === y || (x === usage && y === theirUsage);
  // Specs only get defaults when the other version has them, since an older
  // parser ignores them and would differ on every one.
  const theirsHasDefaults = typeof theirs.parse([], { name: "x" }).defaults === "function";
  const differs = (spec: Spec, input: string[], partial: string) => {
    const diff = difference(
      attempt(parse, input, spec),
      attempt(theirs.parse, input, spec),
      sameAction,
      OPTION_NAMES,
    );
    if (diff) return `parse: ${diff}`;
    // Versions before readNext only have `parse` to compare.
    if (!theirs.readNext) return null;
    const next = nextDifference(readNext(spec, input, partial), theirs.readNext(spec, input, partial));
    return next && `readNext: ${next}`;
  };

  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), { emptySeparators: true, defaults: theirsHasDefaults });
    const spec = gen.spec();
    const input = gen.input(spec);
    const partial = gen.input(spec)[0] ?? "";
    if (differs(spec, input, partial) === null) continue;
    const small = shrink(spec, input, (s, i) => differs(s, i, partial) !== null);
    expect.fail(
      report(
        n,
        small.spec,
        [...small.input, partial],
        `differs from ${ref}, ${differs(small.spec, small.input, partial)}`,
      ),
    );
  }
});
