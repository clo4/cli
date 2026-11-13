// The one shape that still fails: two inline generators in an array lose the type of `tokens` when another
// command in the same list has an inline action. Writing `(tokens: string[])` fixes it where it happens.
import { spec } from "./lib.ts";
spec({
  name: "x",
  subcommands: [
    {
      name: "b",
      action({ args }) {
        void args;
      },
    },
    {
      name: "a",
      args: { name: "f", generators: [{ custom: async (tokens) => tokens }, { custom: (tokens) => tokens }] },
    },
  ],
});
