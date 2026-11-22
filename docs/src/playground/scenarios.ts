import type { Key } from "@/i18n";

export interface Scenario {
  id: string;
  line: string;
  tries: string[];
  tab: Key;
}

export const scenarios: Scenario[] = [
  {
    id: "greet",
    line: "greet Ada --times 2",
    tries: ["greet", "greet Ada --shout", "greet --times 9"],
    tab: "stage.greet",
  },
  {
    id: "wait",
    line: "wait 30s",
    tries: ["wait 2m", "wait 1h", "wait 30x"],
    tab: "stage.wait",
  },
  {
    id: "build",
    line: "demo build --help",
    tries: ["demo --help", "demo help build", "demo build src --jobs 8"],
    tab: "stage.build",
  },
  {
    id: "resize",
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
    line: "serve --port 70000 --mode fast",
    tries: ["serve public --mode release", "serve public --mode relese", "serve --port 70000 --mode fast"],
    tab: "stage.serve",
  },
];
