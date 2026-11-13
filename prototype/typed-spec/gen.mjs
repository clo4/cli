// Usage: node gen.mjs <name> <commands> <kind>   kind: none | all | use
import { writeFileSync, mkdirSync } from "node:fs";
const [name, n, kind, lib = "../lib.ts", fn = "spec"] = process.argv.slice(2);
const groups = +(process.env.GROUPS ?? 0);
const r = (k) => Array.from({ length: k }, (_, i) => i);
const opts = `[${r(6)
  .map((o) => `{ name: "--o${o}", description: "o", args: { name: "v" } }`)
  .join(", ")}]`;
const action = {
  none: "action() {}",
  all: "action({ args }) {}",
  use: 'action({ args: [input], options }) { console.log(input, options.get("--o1")); }',
}[kind];
const cmds = r(+n).map(
  (i) => `  { name: "c${i}", description: "x", args: { name: "input" }, options: ${opts}, ${action} }`,
);
mkdirSync("big", { recursive: true });
const subs = groups
  ? r(groups).map(
      (g) => `{ name: "g${g}", requiresSubcommand: true, subcommands: [\n${cmds.join(",\n")}\n] }`,
    )
  : cmds;
writeFileSync(
  `big/${name}.ts`,
  `import { ${fn} } from "${lib}";\nexport const s = ${fn}({ name: "big", subcommands: [\n${subs.join(",\n")}\n] });\n`,
);
writeFileSync(
  `big/tsconfig.${name}.json`,
  JSON.stringify({ extends: "../tsconfig.json", include: [`${name}.ts`] }),
);
