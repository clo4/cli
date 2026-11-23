import type { Spec, Subcommand } from "@clo4/cli";
import type { Key } from "@/i18n";
import { spec as build } from "./scenarios/build";
import { spec as greet } from "./scenarios/greet";
import { spec as loading } from "./scenarios/loading/main";
import config from "./scenarios/loading/config";
import remote from "./scenarios/loading/remote";
import { spec as resize } from "./scenarios/resize";
import { spec as serve } from "./scenarios/serve";
import { spec as wait } from "./scenarios/wait";

/** A source file of a scenario, and the spec or command it defines. */
export interface ScenarioFile {
  /** Where it is in `scenarios`. */
  path: string;
  root: Spec | Subcommand;
}

export interface Scenario {
  id: string;
  spec: Spec;
  /** Its files, the one with the spec first. */
  files: ScenarioFile[];
  /** The line it starts with. */
  line: string;
  /** Lines to try. */
  tries: string[];
  tab: Key;
}

function scenario(
  id: string,
  spec: Spec,
  {
    main = `${id}.ts`,
    more = [],
    ...rest
  }: Pick<Scenario, "line" | "tries" | "tab"> & {
    /** The file with the spec. */
    main?: string;
    /** Its other files. */
    more?: ScenarioFile[];
  },
): Scenario {
  return { id, spec, files: [{ path: main, root: spec }, ...more], ...rest };
}

export const scenarios: Scenario[] = [
  scenario("greet", greet, {
    line: "greet Ada --times 2",
    tries: ["greet", "greet Ada --shout", "greet --times 9"],
    tab: "stage.greet",
  }),
  scenario("wait", wait, {
    line: "wait 30s",
    tries: ["wait 2m", "wait 1h", "wait 30x"],
    tab: "stage.wait",
  }),
  scenario("build", build, {
    line: "demo build --help",
    tries: ["demo --help", "demo help build", "demo build src --jobs 8"],
    tab: "stage.build",
  }),
  scenario("resize", resize, {
    line: "resize photo.jpg --size 1",
    tries: [
      "resize photo.jpg --size 800x600",
      "resize photo.jpg --size 1920x1080 --fit contain",
      "resize photo.jpg --size 1920x1080 --fit stretch",
    ],
    tab: "stage.resize",
  }),
  scenario("serve", serve, {
    line: "serve --port 70000 --mode fast",
    tries: ["serve public --mode release", "serve public --mode relese", "serve --port 70000 --mode fast"],
    tab: "stage.serve",
  }),
  scenario("loading", loading, {
    main: "loading/main.ts",
    more: [
      { path: "loading/remote.ts", root: remote },
      { path: "loading/config.ts", root: config },
    ],
    line: "demo remote add https://example.com/repo.git",
    tries: ["demo --help", "demo config set user.name Ada", "demo help remote"],
    tab: "stage.loading",
  }),
];
