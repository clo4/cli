import { spec } from "./lib.ts";
import type { CommandBody } from "../../src/index.ts";
spec({
  name: "x",
  subcommands: [{ name: "a", loadSpec: async () => (await import("./remote.ts")).default }],
});
spec({
  name: "x",
  subcommands: [{ name: "b", loadSpec: () => import("./remote.ts").then((m): CommandBody => m.default) }],
});
spec({
  name: "x",
  subcommands: [{ name: "c", loadSpec: () => import("./remote.ts").then((m) => m.default) }],
});
spec({
  name: "x",
  subcommands: [
    {
      name: "d",
      action({ args }) {
        void args;
      },
    },
    { name: "c", loadSpec: () => import("./remote.ts").then((m) => m.default) },
  ],
});
