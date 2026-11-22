import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "wait",
  description: "Wait for a while",
  args: {
    name: "duration",
    description: "How long to wait",
    parse: CLI.seq(CLI.uint, CLI.choice("ms", "s", "m", "h")).map(([amount, unit]) => {
      const milliseconds = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
      return amount * milliseconds[unit];
    }),
  },
  options: [CLI.help],
  subcommands: [CLI.completion],
  action({ args: [duration] }) {
    console.log(`Waiting ${duration} ms`);
  },
});
