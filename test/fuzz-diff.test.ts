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

import { usage } from "../src/help.js";
import { scan } from "../src/parse.js";
import type { Action, Spec } from "../src/types.js";
import { caseNumbers, caseSeed, report } from "./fuzz/cases.js";
import { generator, shrink } from "./fuzz/generate.js";
import { attempt, difference } from "./fuzz/snapshot.js";

const ref = process.env.FUZZ_AGAINST;
const dir = ref ? mkdtempSync(join(tmpdir(), "clo4-cli-fuzz-")) : "";
afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

test.skipIf(!ref)(`scan behaves the same as at ${ref}`, async () => {
  const archive = execFileSync("git", ["archive", ref!, "src"], { maxBuffer: 64 * 1024 * 1024 });
  execFileSync("tar", ["-x", "-C", dir], { input: archive });
  // A plain path keeps one module instance per file, shared with their parse.ts.
  const load = (file: string) => import(join(dir, "src", file));
  const theirs = (await load("parse.ts")) as { scan: typeof scan };
  const theirUsage = ((await load("help.ts")) as { usage: Action }).usage;

  // Each copy of the source has its own built-in usage action.
  const sameAction = (x: Action, y: Action) => x === y || (x === usage && y === theirUsage);
  const differs = (spec: Spec, input: string[]) => {
    for (const strict of [true, false]) {
      const diff = difference(
        attempt(scan, input, spec, strict),
        attempt(theirs.scan, input, spec, strict),
        sameAction,
      );
      if (diff) return `${strict ? "strict" : "lenient"}: ${diff}`;
    }
    return null;
  };

  for (const n of caseNumbers()) {
    const gen = generator(caseSeed(n), { emptySeparators: true });
    const spec = gen.spec();
    const input = gen.input(spec);
    if (differs(spec, input) === null) continue;
    const small = shrink(spec, input, (s, i) => differs(s, i) !== null);
    expect.fail(
      report(n, small.spec, small.input, `differs from ${ref}, ${differs(small.spec, small.input)}`),
    );
  }
});
