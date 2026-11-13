/**
 * Times how long TypeScript takes to check a spec made with `CLI.spec`, as
 * the spec grows. The time should grow in step with the number of commands.
 * If doubling the commands takes four times as long, a type in `src/spec.ts`
 * is making TypeScript compare a list with itself.
 *
 * Usage: node bench/check-time.mjs [commands...]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = join(root, "bench", "dist", "check-time");
const sizes = process.argv.slice(2).map(Number);
const range = (n) => Array.from({ length: n }, (_, i) => i);

/** A spec of `commands` commands in groups of 20, each with 6 options and an inline action. */
function source(commands) {
  const options = range(6).map((o) => `{ name: "--o${o}", description: "o", args: { name: "v" } }`);
  const command = (c) =>
    `{ name: "c${c}", description: "x", args: { name: "input" }, options: [${options.join(", ")}], ` +
    `action({ args: [input], options }) { console.log(input, options.get("--o1")); } }`;
  const group = (g) =>
    `{ name: "g${g}", description: "x", requiresSubcommand: true, subcommands: [${range(20).map(command).join(",\n")}] }`;
  return `import { spec } from "../../../src/index.ts";\nexport default spec({ name: "big", subcommands: [\n${range(
    commands / 20,
  )
    .map(group)
    .join(",\n")}\n] });\n`;
}

mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "tsconfig.json"),
  JSON.stringify({
    extends: "../../../tsconfig.base.json",
    compilerOptions: { noEmit: true, allowImportingTsExtensions: true, types: [] },
    include: ["spec.ts"],
  }),
);
for (const commands of sizes.length > 0 ? sizes : [20, 100, 500, 1000]) {
  writeFileSync(join(dir, "spec.ts"), source(commands));
  const start = performance.now();
  try {
    execFileSync(join(root, "node_modules", ".bin", "tsc"), ["-p", dir], { stdio: "pipe" });
  } catch (error) {
    console.error(String(error.stdout));
    process.exitCode = 1;
  }
  console.log(`${commands} commands: ${((performance.now() - start) / 1000).toFixed(2)} s`);
}
rmSync(dir, { recursive: true });
