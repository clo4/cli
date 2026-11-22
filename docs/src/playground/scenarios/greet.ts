import * as CLI from "@clo4/cli";

export const spec = CLI.spec({
  name: "greet",
  description: "Say hello",
  args: {
    name: "name",
    description: "Who to greet",
    isOptional: true,
    default: "world",
  },
  options: [
    CLI.help,
    {
      name: ["-t", "--times"],
      description: "How many times to say it",
      args: {
        name: "count",
        default: "1",
        parse: CLI.number({ min: 1, max: 5, int: true }),
      },
    },
    {
      name: ["-s", "--shout"],
      description: "Say it louder",
    },
  ],
  subcommands: [CLI.completion],
  action({ args: [name], options }) {
    const greeting = `Hello, ${name}!`;
    for (let i = 0; i < options.get("--times"); i++) {
      console.log(options.has("--shout") ? greeting.toUpperCase() : greeting);
    }
  },
});
