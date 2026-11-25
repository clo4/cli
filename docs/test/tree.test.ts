import type { Subcommand } from "@clo4/cli";
import { analyze } from "@clo4/cli/analyze";
import { expect, test } from "vitest";
import { specRanges } from "@/playground/ranges";
import { spec as build } from "@/playground/scenarios/build";
import buildSource from "@/playground/scenarios/build.ts?raw";
import { spec as main } from "@/playground/scenarios/loading/main";
import mainSource from "@/playground/scenarios/loading/main.ts?raw";
import remote from "@/playground/scenarios/loading/remote";
import remoteSource from "@/playground/scenarios/loading/remote.ts?raw";
import { specTree } from "@/playground/tree";

const tree = specTree([{ file: "build.ts", piece: build, ranges: specRanges(buildSource) }]);
const subcommand = build.subcommands![0] as Subcommand;
const lineOf = (source: string, text: string) => source.split("\n").findIndex((l) => l.includes(text)) + 1;

test("a line is the innermost piece declared on it", () => {
  expect(tree.at("build.ts", lineOf(buildSource, 'name: "input"'))?.piece).toBe(subcommand.args);
});

test("a piece knows the piece it's declared in", () => {
  expect(tree.nodes(subcommand.args as never)[0].parent?.piece).toBe(subcommand);
});

test("a loaded command is found in the file it's loaded from, and at its loading definition", async () => {
  const files = specTree([
    { file: "main.ts", piece: main, ranges: specRanges(mainSource) },
    { file: "remote.ts", piece: remote, ranges: specRanges(remoteSource) },
  ]);
  // The parser reads a copy of the loaded command.
  const [reading] = (await analyze(main, ["remote"])).tokens;
  expect(reading.kind).toBe("subcommand");
  const command = (reading as { command: Subcommand }).command;
  expect(command).not.toBe(remote);
  expect(files.nodes(command).map((node) => [node.file, node.lines?.[0]])).toEqual([
    ["remote.ts", lineOf(remoteSource, "CLI.command(")],
    ["main.ts", lineOf(mainSource, 'name: "remote"') - 1],
  ]);
});
