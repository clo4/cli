import type { Spec } from "@clo4/cli";
import type { Key } from "@/i18n";
import { spec as build } from "./scenarios/build";
import { spec as greet } from "./scenarios/greet";
import { spec as resize } from "./scenarios/resize";
import { spec as serve } from "./scenarios/serve";
import { spec as wait } from "./scenarios/wait";

export interface Scenario {
  /** The name of its source file, in `scenarios`. */
  id: string;
  spec: Spec;
  /** The line it starts with. */
  line: string;
  /** Lines to try. */
  tries: string[];
  tab: Key;
}

export const scenarios: Scenario[] = [
  {
    id: "greet",
    spec: greet,
    line: "greet Ada --times 2",
    tries: ["greet", "greet Ada --shout", "greet --times 9"],
    tab: "stage.greet",
  },
  {
    id: "wait",
    spec: wait,
    line: "wait 30s",
    tries: ["wait 2m", "wait 1h", "wait 30x"],
    tab: "stage.wait",
  },
  {
    id: "build",
    spec: build,
    line: "demo build --help",
    tries: ["demo --help", "demo help build", "demo build src --jobs 8"],
    tab: "stage.build",
  },
  {
    id: "resize",
    spec: resize,
    line: "resize photo.jpg --size 1",
    tries: [
      "resize photo.jpg --size 800x600",
      "resize photo.jpg --size 1920x1080 --fit contain",
      "resize photo.jpg --size 1920x1080 --fit stretch",
    ],
    tab: "stage.resize",
  },
  {
    id: "serve",
    spec: serve,
    line: "serve --port 70000 --mode fast",
    tries: ["serve public --mode release", "serve public --mode relese", "serve --port 70000 --mode fast"],
    tab: "stage.serve",
  },
];
