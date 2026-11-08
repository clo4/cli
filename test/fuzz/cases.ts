// Which fuzz cases to run, from the environment:
//
//   FUZZ_CASES  how many cases to run (default 3000)
//   FUZZ_SEED   which cases to generate (default 1)
//   FUZZ_CASE   run only this case number

import type { Spec } from "../../src/types.js";
import { showSpec } from "./generate.js";

export const SEED = Number(process.env.FUZZ_SEED ?? 1);
const CASES = Number(process.env.FUZZ_CASES ?? 3000);
const ONLY = process.env.FUZZ_CASE === undefined ? undefined : Number(process.env.FUZZ_CASE);

/** The case numbers to run. With `every`, only every nth case runs, unless FUZZ_CASE picks one. */
export function caseNumbers(every = 1): number[] {
  if (ONLY !== undefined) {
    return [ONLY];
  }
  return Array.from({ length: Math.ceil(CASES / every) }, (_, i) => i * every);
}

/** Each case gets its own seed, so one case can run on its own. */
export function caseSeed(n: number): number {
  return Math.imul(SEED ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(n + 1, 0xc2b2ae35);
}

/** A failure message with the case and how to rerun just that case. */
export function report(n: number, spec: Spec, input: readonly string[], problem: string): string {
  return [
    problem,
    `  rerun: FUZZ_SEED=${SEED} FUZZ_CASE=${n}`,
    `  spec:  ${showSpec(spec)}`,
    `  input: ${JSON.stringify(input)}`,
  ].join("\n");
}
